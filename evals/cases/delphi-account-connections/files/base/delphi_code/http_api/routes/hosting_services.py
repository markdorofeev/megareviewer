from typing import Annotated

from fastapi import APIRouter, Depends, Request

from ...services.application import DelphiCode
from ..progress_stream import NdjsonResponse, streamed_responses, streamed_write
from ..request_context import delphi_code_of
from ..request_models import PickedChangesRequest
from ..response_models import HostingServicesResponse, OwnersResponse, RepositoriesResponse, TrackingReportResponse
from ..security import require_same_origin

router = APIRouter()
changes_tracking = APIRouter(dependencies=[Depends(require_same_origin)])


@router.get("/api/hosting-services", response_model=HostingServicesResponse)
def hosting_services(delphi_code: Annotated[DelphiCode, Depends(delphi_code_of)]) -> dict:
    services = delphi_code.hosting_services_with_credentials(refresh=True)
    return {"hosting_services": [service.to_json() for service in services]}


@router.get("/api/hosting-services/{domain}/owners", response_model=OwnersResponse)
def owners(delphi_code: Annotated[DelphiCode, Depends(delphi_code_of)], domain: str) -> dict:
    listed = delphi_code.owners_if_listable(delphi_code.hosting_service(domain))
    return {"owners": None if listed is None else [owner.to_json() for owner in listed]}


@router.get("/api/hosting-services/{domain}/owners/{owner}/repositories", response_model=RepositoriesResponse)
def repositories(delphi_code: Annotated[DelphiCode, Depends(delphi_code_of)], domain: str, owner: str) -> dict:
    listed = delphi_code.repositories_of_owner(delphi_code.hosting_service(domain), owner)
    return {"repositories": [repository.to_json() for repository in listed]}


@changes_tracking.post(
    "/api/projects/picked", response_class=NdjsonResponse, responses=streamed_responses(TrackingReportResponse)
)
def apply_picked_changes(
    request: Request, delphi_code: Annotated[DelphiCode, Depends(delphi_code_of)], body: PickedChangesRequest
):
    return streamed_write(
        request,
        lambda progress: delphi_code.apply_picked_changes(
            body.changes(), body.ref, body.selection(), not body.no_sync, progress
        ),
        TrackingReportResponse,
    )
