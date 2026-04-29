from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import K3sClusterApp
from app.schemas.inventory import K3sClusterAppBulkCreate, K3sClusterAppCreate, K3sClusterAppRead

router = APIRouter(prefix="/k3s-cluster-apps", tags=["k3s_cluster_apps"])


@router.get("/", response_model=List[K3sClusterAppRead])
def list_k3s_cluster_apps(
    cluster_id: int | None = None,
    app_id: int | None = None,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    q = db.query(K3sClusterApp)
    if cluster_id is not None:
        q = q.filter(K3sClusterApp.cluster_id == cluster_id)
    if app_id is not None:
        q = q.filter(K3sClusterApp.app_id == app_id)
    return q.all()


@router.post("/", response_model=K3sClusterAppRead, status_code=status.HTTP_201_CREATED)
def create_k3s_cluster_app(
    body: K3sClusterAppCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    existing = db.get(K3sClusterApp, (body.cluster_id, body.app_id))
    if existing:
        raise HTTPException(status_code=409, detail="Association already exists")
    obj = K3sClusterApp(cluster_id=body.cluster_id, app_id=body.app_id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
def bulk_create_k3s_cluster_apps(
    body: K3sClusterAppBulkCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    created = 0
    for app_id in body.app_ids:
        if db.get(K3sClusterApp, (body.cluster_id, app_id)) is None:
            db.add(K3sClusterApp(cluster_id=body.cluster_id, app_id=app_id))
            created += 1
    db.commit()
    return {"created": created}


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
def delete_k3s_cluster_app(
    cluster_id: int,
    app_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = db.get(K3sClusterApp, (cluster_id, app_id))
    if not obj:
        raise HTTPException(status_code=404, detail="Association not found")
    db.delete(obj)
    db.commit()
