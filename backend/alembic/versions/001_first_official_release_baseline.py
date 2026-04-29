"""first official release baseline

Revision ID: 001
Revises:
Create Date: 2026-04-29

Fresh Docker installs load the complete MySQL schema from db/schema.sql and
stamp this revision during database initialization. Future public releases should
add incremental Alembic migrations on top of this baseline.
"""

from typing import Sequence, Union

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
