from alembic import context

from app.config import Settings
from app.database import Base, Database


def run_migrations():
    database = Database(Settings().database_url)
    with database.engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    database.engine.dispose()


run_migrations()
