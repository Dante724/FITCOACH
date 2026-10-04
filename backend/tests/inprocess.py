"""Import the API in-process against an in-memory MongoDB (for tests that need no running server)."""
import importlib
import os
import sys

os.environ.update({"MONGO_URL": "mongodb://mock", "DB_NAME": "inprocess_test", "JWT_SECRET": "test-secret-for-inprocess-tests-0123456789",
                   "GOOGLE_CLIENT_ID": "fitcoach-test.apps.googleusercontent.com", "EMAIL_ENABLED": "false",
                   "ADMIN_EMAIL": "admin@fitcoach.com", "ADMIN_PASSWORD": "Admin@12345", "SEED_DEMO_DATA": "true"})
import motor.motor_asyncio  # noqa: E402
import mongomock_motor  # noqa: E402

motor.motor_asyncio.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
server = importlib.import_module("server")
