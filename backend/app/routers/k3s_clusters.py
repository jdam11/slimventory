from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.crud import create_record, delete_record, get_or_404, list_records, update_record
from app.database import get_db
from app.deps import require_admin, require_authenticated
from app.models.auth import AppUser
from app.models.inventory import K3sCluster
from app.schemas.inventory import K3sClusterCreate, K3sClusterRead, K3sClusterUpdate, PageResponse

router = APIRouter(prefix="/k3s-clusters", tags=["k3s_clusters"])


@router.get("/", response_model=PageResponse[K3sClusterRead])
def list_clusters(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    items, total = list_records(db, K3sCluster, skip, limit)
    return {"items": items, "total": total}


@router.get("/{record_id}", response_model=K3sClusterRead)
def get_cluster(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_authenticated),
):
    return get_or_404(db, K3sCluster, record_id)


@router.post("/", response_model=K3sClusterRead, status_code=status.HTTP_201_CREATED)
def create_cluster(
    body: K3sClusterCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    return create_record(db, K3sCluster, body.model_dump())


@router.patch("/{record_id}", response_model=K3sClusterRead)
def update_cluster(
    record_id: int,
    body: K3sClusterUpdate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, K3sCluster, record_id)
    return update_record(db, obj, body.model_dump(exclude_unset=True))


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cluster(
    record_id: int,
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    obj = get_or_404(db, K3sCluster, record_id)
    delete_record(db, obj)
