from app.models.inventory import Datastore
from app.schemas.inventory import DatastoreCreate, DatastoreRead, DatastoreUpdate

from ._factory import make_crud_router

router = make_crud_router(
    "datastores",
    "datastores",
    Datastore,
    DatastoreCreate,
    DatastoreUpdate,
    DatastoreRead,
)
