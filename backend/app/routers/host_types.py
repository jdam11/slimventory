from app.models.inventory import HostType
from app.schemas.inventory import HostTypeCreate, HostTypeRead, HostTypeUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "host-types",
    "host_types",
    HostType,
    HostTypeCreate,
    HostTypeUpdate,
    HostTypeRead,
)
