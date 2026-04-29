from app.models.inventory import HostStatus
from app.schemas.inventory import HostStatusCreate, HostStatusRead, HostStatusUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "host-statuses",
    "host_statuses",
    HostStatus,
    HostStatusCreate,
    HostStatusUpdate,
    HostStatusRead,
)
