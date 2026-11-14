from pydantic import BaseModel, ConfigDict, Field

from ..domain.selection import DEFAULT_MAX_BYTES, FileSelection
from ..domain.tracking_changes import TrackingChanges


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FileSelectionRequest(RequestModel):
    path: list[str] = Field(default_factory=list, description="Project-relative globs, such as src/*")
    language: list[str] = Field(default_factory=list, description="Languages, such as python or typescript")
    ignore: list[str] = Field(default_factory=list, description="Extra gitignore-style patterns to skip")
    max_bytes: int = Field(DEFAULT_MAX_BYTES, ge=1, description="Skip files larger than this")

    def selection(self) -> FileSelection:
        return FileSelection(self.path, self.language, self.ignore, self.max_bytes)


class IndexRequest(FileSelectionRequest):
    project: str = Field(description="Absolute project path, indexed key or folder name")


class AddRequest(FileSelectionRequest):
    sources: list[str] = Field(min_length=1, description="Project directories or host/owner/repository")
    ref: str | None = Field(None, description="Branch or tag of remote repositories")
    no_sync: bool = Field(False, description="Only update the registry")


class SyncRequest(RequestModel):
    projects: list[str] = Field(default_factory=list, description="Tracked project paths, keys or names; empty for all")


class SetupRequest(RequestModel):
    import_from: str | None = Field(None, alias="from", description="Prepared model directory to import")


class PickedChangesRequest(FileSelectionRequest):
    added: list[str] = Field(default_factory=list, description="Repository keys to track, such as github.com/acme/api")
    removed: list[str] = Field(default_factory=list, description="Repository keys to stop tracking")
    ref: str | None = Field(None, description="Branch or tag of the added repositories")
    no_sync: bool = Field(False, description="Only update the registry")

    def changes(self) -> TrackingChanges:
        return TrackingChanges(self.added, self.removed)


class AccountTokenRequest(RequestModel):
    token: str = Field(min_length=1, description="An API token for the hosting service")
    username: str | None = Field(None, description="The account the token belongs to, when the service needs it")
