from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchHitResponse(ResponseModel):
    path: str
    language: str
    text: str
    start_line: int
    end_line: int
    distance: float
    score: float
    url: str | None = None
    key: str | None = None
    project: str | None = None


class ProjectSearchHitsResponse(ResponseModel):
    project: str | None
    key: str
    index_directory: str
    ref: str | None = None
    commit: str | None = None
    query: str
    results: list[SearchHitResponse]


class CrossProjectSearchHitsResponse(ResponseModel):
    project: None
    projects: list[str]
    query: str
    results: list[SearchHitResponse]


class ListedProjectResponse(ResponseModel):
    key: str
    tracked: bool
    source: str | None
    project: str | None
    index_directory: str | None
    ready: bool
    indexed_at: str | None
    ref: str | None = None
    commit: str | None = None


class ProjectListingResponse(ResponseModel):
    registry: str
    repos: list[ListedProjectResponse]


class IndexStateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str
    index_directory: str
    schema_version: int | None = None
    project: str | None = None
    source: dict[str, Any] | None = None
    ready: bool = False
    model: str | None = None
    model_sha256: str | None = None
    paths: list[str] | None = None
    languages: list[str] | None = None
    ignores: list[str] | None = None
    max_bytes: int | None = None
    indexed_at: str | None = None
    files: int | None = None
    chunks: int | None = None


class DiagnosticsResponse(ResponseModel):
    version: str
    project: str | None
    key: str
    index_directory: str | None
    model: str
    model_sha256: str
    dimensions: int
    self_distance: float
    device: str
    cocoindex_storage: str
    offline: bool
    network_guard: str
    sqlite: str
    dependencies: dict[str, str]


class ErrorResponse(ResponseModel):
    code: str
    message: str


class FileChangesResponse(ResponseModel):
    num_execution_starts: int = 0
    num_unchanged: int = 0
    num_adds: int = 0
    num_deletes: int = 0
    num_reprocesses: int = 0
    num_errors: int = 0


class IndexingOutcomeResponse(ResponseModel):
    project: str | None
    key: str
    index_directory: str
    ref: str | None = None
    commit: str | None = None
    files: int
    chunks: int
    skipped: int
    incremental: FileChangesResponse


class ProjectIndexedResponse(IndexingOutcomeResponse):
    source: str
    ok: Literal[True]
    unchanged: Literal[False]


class ProjectUpToDateResponse(ResponseModel):
    source: str
    ok: Literal[True]
    unchanged: Literal[True]
    project: None
    key: str
    index_directory: str
    ref: str | None = None
    commit: str | None = None


class ProjectSyncFailedResponse(ResponseModel):
    source: str
    ok: Literal[False]
    error: ErrorResponse


SyncedProjectResponse = ProjectIndexedResponse | ProjectUpToDateResponse | ProjectSyncFailedResponse


class SyncReportResponse(ResponseModel):
    registry: str
    repos: list[SyncedProjectResponse]


class TrackedSourceResponse(ResponseModel):
    source: str
    key: str


class UntrackedProjectResponse(ResponseModel):
    key: str
    deleted_index: str | None


class TrackingReportResponse(ResponseModel):
    registry: str
    repos: list[TrackedSourceResponse | SyncedProjectResponse]
    removed: list[UntrackedProjectResponse] | None = None
    cancelled: bool | None = None


class ProjectRemovalResponse(ResponseModel):
    key: str
    untracked: bool
    deleted_index: str | None


class AgentConnectionResponse(ResponseModel):
    agent: str
    title: str
    outcome: str
    config: str | None
    detail: str | None
    skill: str | None
    plugin_brings_the_skill: bool


class ModelSetupResponse(ResponseModel):
    model: str
    index_root: str
    reused: bool
    diagnostics: DiagnosticsResponse
    agents: list[AgentConnectionResponse] | None = None


class HostingServiceResponse(ResponseModel):
    domain: str
    name: str
    owner_noun: str
    suggested_owner: str | None


class HostingServicesResponse(ResponseModel):
    hosting_services: list[HostingServiceResponse]


class OwnerResponse(ResponseModel):
    slug: str
    name: str


class OwnersResponse(ResponseModel):
    owners: list[OwnerResponse] | None = Field(
        description="The owners these credentials can list, or null when the owner must be typed"
    )


class RepositoryResponse(ResponseModel):
    key: str
    host: str
    owner: str
    slug: str
    description: str
    private: bool


class RepositoriesResponse(ResponseModel):
    repositories: list[RepositoryResponse]
