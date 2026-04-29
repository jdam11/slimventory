from app.models.inventory import App
from app.schemas.inventory import AppCreate, AppRead, AppUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "apps",
    "apps",
    App,
    AppCreate,
    AppUpdate,
    AppRead,
)
