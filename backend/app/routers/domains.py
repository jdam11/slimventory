from app.models.inventory import Domain
from app.schemas.inventory import DomainCreate, DomainRead, DomainUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "domains",
    "domains",
    Domain,
    DomainCreate,
    DomainUpdate,
    DomainRead,
)
