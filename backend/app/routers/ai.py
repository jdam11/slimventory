import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models.ai import AiAgentType, AiConversation, AiMessageRole, AiProvider, AiTool
from app.models.auth import AppUser
from app.models.job_templates import JobTemplate
from app.schemas.ai import (
    AiAgentCreate,
    AiAgentPromptAssistRequest,
    AiAgentRead,
    AiAgentUpdate,
    AiChatStreamRequest,
    AiConversationDetailRead,
    AiConversationRead,
    AiMessageRead,
    AiProviderCreate,
    AiProviderModelsRead,
    AiProviderRead,
    AiProviderTestRequest,
    AiProviderUpdate,
    AiSettingsRead,
    AiSettingsUpdate,
    AiToolCandidateRead,
    AiToolCreate,
    AiToolPrefillRead,
    AiToolPrefillRequest,
    AiToolRead,
    AiToolUpdate,
)
from app.schemas.git import PlaybookRunRead
from app.schemas.inventory import PageResponse
from app.services.ai import (
    DEFAULT_CONVERSATION_TITLE,
    UNSET,
    AiError,
    _extract_action,
    build_manager_route_messages,
    build_prompt_assist_messages,
    build_safe_context,
    build_specialist_prompt_messages,
    build_transient_provider,
    collect_provider_response,
    create_agent,
    create_ai_tool,
    create_conversation,
    draft_tool_prefill,
    encode_provider_api_key,
    ensure_feature_settings,
    generate_conversation_title,
    get_agent_by_id,
    get_agent_by_type,
    get_agent_provider,
    get_conversation_for_user,
    get_message_agent_ref,
    list_agents,
    list_ai_tools,
    list_conversation_messages,
    list_provider_models,
    list_tool_candidates,
    list_user_conversations,
    maybe_run_ai_tool,
    parse_manager_route,
    save_message,
    set_feature_enabled,
    set_provider_default,
    stream_provider_response,
    to_agent_read,
    to_provider_read,
    to_settings_read,
    to_tool_read,
    update_agent,
    update_ai_tool,
    update_conversation_metadata,
    update_conversation_title,
)

router = APIRouter(prefix="/ai", tags=["ai"])


def _message_read(db: Session, message) -> AiMessageRead:
    return AiMessageRead.model_validate(
        {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "context_summary": message.context_summary,
            "agent": get_message_agent_ref(db, message),
            "created_at": message.created_at,
        }
    )


def _require_chat_enabled(db: Session) -> None:
    settings = ensure_feature_settings(db)
    if not settings.agentic_noc_enabled:
        raise HTTPException(status_code=409, detail="Agentic NOC / IT is disabled")


@router.get("/providers", response_model=list[AiProviderRead])
def list_enabled_providers(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    providers = (
        db.execute(
            select(AiProvider)
            .where(AiProvider.is_enabled.is_(True))
            .order_by(AiProvider.is_default.desc(), AiProvider.name.asc())
        )
        .scalars()
        .all()
    )
    return [AiProviderRead.model_validate(to_provider_read(provider)) for provider in providers]


@router.get("/admin/providers", response_model=list[AiProviderRead])
def list_admin_providers(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    providers = db.execute(select(AiProvider).order_by(AiProvider.name.asc())).scalars().all()
    return [AiProviderRead.model_validate(to_provider_read(provider)) for provider in providers]


@router.get("/admin/providers/{provider_id}/models", response_model=AiProviderModelsRead)
async def get_admin_provider_models(
    provider_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    provider = db.get(AiProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="AI provider not found")
    try:
        models = await list_provider_models(provider)
    except AiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return AiProviderModelsRead.model_validate(
        {
            "provider_id": provider.id,
            "provider_name": provider.name,
            "default_model": provider.default_model,
            "models": models,
        }
    )


@router.post("/admin/providers/test", response_model=AiProviderModelsRead)
async def test_admin_provider(
    body: AiProviderTestRequest,
    _: AppUser = Depends(require_admin),
):
    provider = build_transient_provider(
        provider_type=body.provider_type,
        base_url=body.base_url,
        default_model=body.default_model,
        api_key=body.api_key,
        request_timeout_seconds=body.request_timeout_seconds,
        name="Test provider",
    )
    try:
        models = await list_provider_models(provider)
    except AiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return AiProviderModelsRead.model_validate(
        {
            "provider_id": None,
            "provider_name": provider.name,
            "default_model": provider.default_model or (models[0] if models else None),
            "models": models,
        }
    )


@router.post("/admin/providers", response_model=AiProviderRead, status_code=status.HTTP_201_CREATED)
def create_provider(
    body: AiProviderCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    provider = AiProvider(
        name=body.name,
        provider_type=body.provider_type,
        base_url=body.base_url,
        default_model=body.default_model,
        api_key=encode_provider_api_key(body.api_key),
        is_enabled=body.is_enabled,
        is_default=body.is_default,
        request_timeout_seconds=body.request_timeout_seconds,
    )
    db.add(provider)
    db.flush()
    set_provider_default(db, provider)
    db.commit()
    db.refresh(provider)
    return AiProviderRead.model_validate(to_provider_read(provider))


@router.patch("/admin/providers/{provider_id}", response_model=AiProviderRead)
def update_provider(
    provider_id: int,
    body: AiProviderUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    provider = db.get(AiProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="AI provider not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "api_key":
            if value is not None:
                provider.api_key = encode_provider_api_key(value)
            continue
        setattr(provider, key, value)
    set_provider_default(db, provider)
    db.commit()
    db.refresh(provider)
    return AiProviderRead.model_validate(to_provider_read(provider))


@router.delete("/admin/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(
    provider_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    provider = db.get(AiProvider, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="AI provider not found")
    db.delete(provider)
    db.commit()


@router.get("/admin/settings", response_model=AiSettingsRead)
def get_settings(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return AiSettingsRead.model_validate(to_settings_read(ensure_feature_settings(db)))


@router.patch("/admin/settings", response_model=AiSettingsRead)
def update_settings(
    body: AiSettingsUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return AiSettingsRead.model_validate(to_settings_read(set_feature_enabled(db, body.agentic_noc_enabled)))


@router.get("/admin/agents", response_model=list[AiAgentRead])
def get_agents(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return [AiAgentRead.model_validate(to_agent_read(db, agent)) for agent in list_agents(db)]


@router.post("/admin/agents", response_model=AiAgentRead, status_code=status.HTTP_201_CREATED)
def create_admin_agent(
    body: AiAgentCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        agent = create_agent(
            db,
            name=body.name,
            description=body.description,
            provider_id=body.provider_id,
            model=body.model,
            system_prompt=body.system_prompt,
            is_enabled=body.is_enabled,
        )
    except AiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AiAgentRead.model_validate(to_agent_read(db, agent))


@router.patch("/admin/agents/{agent_id}", response_model=AiAgentRead)
def patch_agent(
    agent_id: int,
    body: AiAgentUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    agent = get_agent_by_id(db, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="AI agent not found")
    changes = body.model_dump(exclude_unset=True)
    try:
        updated = update_agent(
            db,
            agent,
            name=changes["name"] if "name" in changes else UNSET,
            description=changes["description"] if "description" in changes else UNSET,
            provider_id=changes["provider_id"] if "provider_id" in changes else UNSET,
            model=changes["model"] if "model" in changes else UNSET,
            system_prompt=changes["system_prompt"] if "system_prompt" in changes else UNSET,
            is_enabled=changes["is_enabled"] if "is_enabled" in changes else UNSET,
        )
    except AiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AiAgentRead.model_validate(to_agent_read(db, updated))


@router.delete("/admin/agents/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    agent = get_agent_by_id(db, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="AI agent not found")
    if agent.agent_type != AiAgentType.custom:
        raise HTTPException(status_code=400, detail="Built-in AI agents cannot be deleted")
    db.delete(agent)
    db.commit()


@router.post("/admin/prompt-assist/stream")
async def stream_prompt_assist(
    body: AiAgentPromptAssistRequest,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    agent = get_agent_by_id(db, body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="AI agent not found")
    try:
        provider = get_agent_provider(db, agent)
    except AiError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    model = agent.model or provider.default_model
    context_summary, context_data = build_safe_context(db, user=current_user, page_context=None)
    prompt_messages = build_prompt_assist_messages(
        db,
        agent=agent,
        current_prompt=body.current_prompt or agent.system_prompt,
        request=body.message,
        context_summary=context_summary,
        context_data=context_data,
    )

    async def event_stream():
        yield f"data: {json.dumps({'type': 'message_start', 'mode': 'prompt_assist'})}\n\n"
        try:
            async for chunk in stream_provider_response(provider, model=model, prompt_messages=prompt_messages):
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunk})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'message_complete'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/admin/tool-candidates", response_model=list[AiToolCandidateRead])
def get_tool_candidates(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return [AiToolCandidateRead.model_validate(item) for item in list_tool_candidates(db)]


@router.get("/admin/tools", response_model=list[AiToolRead])
def get_tools(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return [AiToolRead.model_validate(to_tool_read(db, tool)) for tool in list_ai_tools(db, include_disabled=True)]


@router.post("/admin/tools", response_model=AiToolRead, status_code=status.HTTP_201_CREATED)
def create_tool(
    body: AiToolCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    try:
        tool = create_ai_tool(
            db,
            job_template_id=body.job_template_id,
            is_enabled=body.is_enabled,
            tool_name=body.tool_name,
            description=body.description,
            when_to_use=body.when_to_use,
            input_hint=body.input_hint,
            example_payload=body.example_payload,
            safety_notes=body.safety_notes,
            agent_ids=body.agent_ids,
        )
    except AiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AiToolRead.model_validate(to_tool_read(db, tool))


@router.patch("/admin/tools/{tool_id}", response_model=AiToolRead)
def patch_tool(
    tool_id: int,
    body: AiToolUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    tool = db.get(AiTool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="AI tool not found")
    changes = body.model_dump(exclude_unset=True)
    try:
        updated = update_ai_tool(
            db,
            tool,
            is_enabled=changes["is_enabled"] if "is_enabled" in changes else None,
            tool_name=changes["tool_name"] if "tool_name" in changes else UNSET,
            description=changes["description"] if "description" in changes else UNSET,
            when_to_use=changes["when_to_use"] if "when_to_use" in changes else UNSET,
            input_hint=changes["input_hint"] if "input_hint" in changes else UNSET,
            example_payload=changes["example_payload"] if "example_payload" in changes else UNSET,
            safety_notes=changes["safety_notes"] if "safety_notes" in changes else UNSET,
            agent_ids=changes["agent_ids"] if "agent_ids" in changes else UNSET,
        )
    except AiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AiToolRead.model_validate(to_tool_read(db, updated))


@router.delete("/admin/tools/{tool_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tool(
    tool_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    tool = db.get(AiTool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="AI tool not found")
    db.delete(tool)
    db.commit()


@router.post("/admin/tools/prefill", response_model=AiToolPrefillRead)
async def prefill_tool(
    body: AiToolPrefillRequest,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    template = db.get(JobTemplate, body.job_template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Job template not found")
    draft = await draft_tool_prefill(
        db,
        template=template,
        agent_id=body.agent_id,
        instructions=body.instructions,
        current_draft={
            "tool_name": body.current_tool_name,
            "description": body.current_description,
            "when_to_use": body.current_when_to_use,
            "input_hint": body.current_input_hint,
            "safety_notes": body.current_safety_notes,
        },
    )
    return AiToolPrefillRead.model_validate(draft)


@router.get("/conversations", response_model=PageResponse[AiConversationRead])
def list_conversations(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    total = (
        db.scalar(select(func.count()).select_from(AiConversation).where(AiConversation.user_id == current_user.id))
        or 0
    )
    items = list_user_conversations(db, current_user.id, skip + limit)[skip : skip + limit]
    return {"items": items, "total": total}


@router.get("/conversations/{conversation_id}", response_model=AiConversationDetailRead)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    conversation = get_conversation_for_user(db, conversation_id, current_user.id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return AiConversationDetailRead.model_validate(
        {
            "id": conversation.id,
            "title": conversation.title,
            "provider_id": conversation.provider_id,
            "model": conversation.model,
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "messages": [_message_read(db, message) for message in list_conversation_messages(db, conversation.id)],
        }
    )


@router.post("/conversations", response_model=AiConversationRead, status_code=status.HTTP_201_CREATED)
def create_empty_conversation(
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    conversation = create_conversation(
        db,
        user_id=current_user.id,
        provider_id=None,
        model=None,
        title_seed=DEFAULT_CONVERSATION_TITLE,
    )
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    conversation = get_conversation_for_user(db, conversation_id, current_user.id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conversation)
    db.commit()


@router.post("/chat/stream")
async def stream_chat(
    body: AiChatStreamRequest,
    db: Session = Depends(get_db),
    current_user: AppUser = Depends(require_admin),
):
    _require_chat_enabled(db)
    manager = get_agent_by_type(db, agent_type=AiAgentType.manager)
    try:
        manager_provider = get_agent_provider(db, manager)
    except AiError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    conversation = (
        get_conversation_for_user(db, body.conversation_id, current_user.id)
        if body.conversation_id is not None
        else None
    )
    if body.conversation_id is not None and conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation is None:
        conversation = create_conversation(
            db,
            user_id=current_user.id,
            provider_id=manager_provider.id,
            model=manager.model or manager_provider.default_model,
            title_seed=DEFAULT_CONVERSATION_TITLE,
        )

    context_summary, context_data = build_safe_context(db, user=current_user, page_context=body.page_context)
    save_message(
        db,
        conversation_id=conversation.id,
        role=AiMessageRole.user,
        content=body.message,
        context_summary=context_summary,
    )

    async def event_stream():
        yield f"data: {json.dumps({'type': 'message_start', 'conversation_id': conversation.id})}\n\n"
        try:
            manager_route_text = await collect_provider_response(
                manager_provider,
                model=manager.model or manager_provider.default_model,
                prompt_messages=build_manager_route_messages(
                    db,
                    conversation_id=conversation.id,
                    manager=manager,
                    context_summary=context_summary,
                    context_data=context_data,
                    user_message=body.message,
                ),
            )
            mode, selected_agent, direct_reply = parse_manager_route(
                db,
                text=manager_route_text,
                user_message=body.message,
                page_context=body.page_context,
            )
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            return

        if mode == "direct":
            final_text = direct_reply or "No response generated."
            update_conversation_metadata(
                db,
                conversation,
                provider_id=manager_provider.id,
                model=manager.model or manager_provider.default_model,
            )
            assistant_message = save_message(
                db,
                conversation_id=conversation.id,
                role=AiMessageRole.assistant,
                content=final_text,
                context_summary=context_summary,
                agent_id=manager.id,
            )
            if conversation.title == DEFAULT_CONVERSATION_TITLE:
                title = await generate_conversation_title(
                    manager_provider,
                    model=manager.model or manager_provider.default_model,
                    user_message=body.message,
                    assistant_message=final_text,
                )
                update_conversation_title(db, conversation, title=title)
            manager_payload = {
                "id": manager.id,
                "agent_type": manager.agent_type.value,
                "name": manager.name,
            }
            yield f"data: {json.dumps({'type': 'agent_selected', 'agent': manager_payload})}\n\n"
            yield f"data: {json.dumps({'type': 'chunk', 'text': final_text})}\n\n"
            message_complete_payload = {
                "type": "message_complete",
                "conversation_id": conversation.id,
                "message_id": assistant_message.id,
                "agent": manager_payload,
            }
            yield f"data: {json.dumps(message_complete_payload)}\n\n"
            return

        if selected_agent is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'No specialist agent is available'})}\n\n"
            return
        try:
            provider = get_agent_provider(db, selected_agent)
        except AiError as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            return

        model = selected_agent.model or provider.default_model
        update_conversation_metadata(db, conversation, provider_id=provider.id, model=model)
        selected_agent_payload = {
            "id": selected_agent.id,
            "agent_type": selected_agent.agent_type.value,
            "name": selected_agent.name,
        }
        yield f"data: {json.dumps({'type': 'agent_selected', 'agent': selected_agent_payload})}\n\n"

        full_text = ""
        try:
            async for chunk in stream_provider_response(
                provider,
                model=model,
                prompt_messages=build_specialist_prompt_messages(
                    db,
                    conversation_id=conversation.id,
                    agent=selected_agent,
                    context_summary=context_summary,
                    context_data=context_data,
                    user_message=body.message,
                ),
            ):
                full_text += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunk})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            return

        clean_text, action = _extract_action(full_text)
        assistant_message = save_message(
            db,
            conversation_id=conversation.id,
            role=AiMessageRole.assistant,
            content=clean_text,
            context_summary=context_summary,
            agent_id=selected_agent.id,
        )
        if conversation.title == DEFAULT_CONVERSATION_TITLE:
            title = await generate_conversation_title(
                provider,
                model=model,
                user_message=body.message,
                assistant_message=clean_text,
            )
            update_conversation_title(db, conversation, title=title)
        run = maybe_run_ai_tool(
            db,
            user=current_user,
            conversation_id=conversation.id,
            user_message=body.message,
            agent=selected_agent,
            action=action,
        )
        payload = {
            "type": "message_complete",
            "conversation_id": conversation.id,
            "message_id": assistant_message.id,
            "agent": {
                "id": selected_agent.id,
                "agent_type": selected_agent.agent_type.value,
                "name": selected_agent.name,
            },
        }
        if run is not None:
            payload["triggered_run"] = PlaybookRunRead.model_validate(run).model_dump(mode="json")
        yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
