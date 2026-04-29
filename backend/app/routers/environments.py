from app.models.inventory import Environment
from app.schemas.inventory import EnvironmentCreate, EnvironmentRead, EnvironmentUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "environments",
    "environments",
    Environment,
    EnvironmentCreate,
    EnvironmentUpdate,
    EnvironmentRead,
)
