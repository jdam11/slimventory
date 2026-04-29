from app.models.inventory import Role
from app.schemas.inventory import RoleCreate, RoleRead, RoleUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "roles",
    "roles",
    Role,
    RoleCreate,
    RoleUpdate,
    RoleRead,
)
