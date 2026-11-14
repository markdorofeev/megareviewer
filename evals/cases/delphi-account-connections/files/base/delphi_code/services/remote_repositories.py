from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import TYPE_CHECKING

from ..domain.errors import Failure, FailureKind
from ..domain.hosting_services import HostingService, Owner, Repository
from ..domain.selection import FileSelection
from ..domain.tracking_changes import TrackingChanges
from ..domain.tracking_report import TrackingReport
from ..infrastructure.registry import Registry
from ..infrastructure.store import Store
from .progress import Progress
from .tracking import apply_tracking_changes

if TYPE_CHECKING:
    from ..infrastructure.hosts import RepositoryHost


MISSING_CREDENTIALS_MESSAGE = (
    "Picking repositories needs Bitbucket or GitHub credentials: set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD "
    "or GITHUB_TOKEN, sign in with gh auth login, or store git credentials for bitbucket.org or github.com"
)


class ConnectedHostingServices:
    def __init__(self, find_hosts: Callable[[], Sequence[RepositoryHost]] | None = None):
        self._find_hosts = find_hosts
        self._hosts_by_domain: dict[str, RepositoryHost] = {}

    def with_credentials(self, refresh: bool = False) -> list[HostingService]:
        if refresh:
            self._hosts_by_domain = {}
        return [host.description() for host in self._connected().values()]

    def named(self, domain: str) -> HostingService:
        host = self._connected().get(domain)
        if host is None:
            raise Failure("remote_auth_missing", f"No credentials found for {domain}", FailureKind.PREREQUISITE_MISSING)
        return host.description()

    def owners_if_listable(self, service: HostingService, progress: Progress) -> list[Owner] | None:
        host = self._host_of(service)
        progress.owners_listing_started(service.name, service.owner_noun)
        try:
            owners = host.owners()
        except Failure as failure:
            if failure.code != "remote_permission_denied":
                raise
            return None
        finally:
            progress.listing_finished()
        if not owners:
            raise Failure("remote_empty", f"Your {service.name} account has no repositories", FailureKind.NOT_FOUND)
        return owners

    def repositories_of_owner(self, service: HostingService, owner: str, progress: Progress) -> list[Repository]:
        host = self._host_of(service)
        progress.repositories_listing_started(service.name, owner)
        try:
            repositories = host.repositories(owner)
        finally:
            progress.listing_finished()
        if not repositories:
            raise Failure(
                "remote_empty",
                f"You have no repositories in the {service.name} {service.owner_noun} {owner}",
                FailureKind.NOT_FOUND,
            )
        return repositories

    def _connected(self) -> dict[str, RepositoryHost]:
        if not self._hosts_by_domain:
            self._hosts_by_domain = {host.domain: host for host in self._hosts_with_credentials()}
        if not self._hosts_by_domain:
            raise Failure("remote_auth_missing", MISSING_CREDENTIALS_MESSAGE, FailureKind.PREREQUISITE_MISSING)
        return self._hosts_by_domain

    def _hosts_with_credentials(self) -> Sequence[RepositoryHost]:
        if self._find_hosts is not None:
            return self._find_hosts()
        from ..infrastructure.hosts import configured_hosts

        return configured_hosts()

    def _host_of(self, service: HostingService) -> RepositoryHost:
        host = self._connected().get(service.domain)
        if host is None:
            raise Failure(
                "remote_auth_missing", f"No credentials found for {service.name}", FailureKind.PREREQUISITE_MISSING
            )
        return host


def tracked_keys(registry: Registry) -> set[str]:
    return {entry.current_key() for entry in registry.entries()}


def apply_picked_changes(
    store: Store,
    registry: Registry,
    changes: TrackingChanges | None,
    ref: str | None,
    selection: FileSelection,
    model_location: str,
    sync_now: bool,
    progress: Progress,
) -> TrackingReport:
    if changes is None:
        return TrackingReport(str(registry.path), [], untracked=[], cancelled=True)
    _require_remote_repository_keys([*changes.added, *changes.removed])
    applied = apply_tracking_changes(store, registry, changes, ref, selection, model_location, sync_now, progress)
    return replace(applied, cancelled=False)


def _require_remote_repository_keys(keys: list[str]):
    from ..infrastructure.sources import GitRemoteSource, source_from_registry

    for key in keys:
        source = source_from_registry(key)
        if not isinstance(source, GitRemoteSource) or source.key.lower() != key:
            raise Failure(
                "usage", f"{key} is not a repository such as github.com/owner/repository", FailureKind.INVALID_REQUEST
            )
