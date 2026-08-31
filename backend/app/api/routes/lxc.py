from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.schemas import TemplateSchema
from app.services.proxmox import provisioning_service

router = APIRouter(prefix="/lxc", tags=["lxc"])


@router.get("/templates", response_model=list[TemplateSchema])
def get_templates(current_user: CurrentUser):
    return provisioning_service.get_lxc_templates()
