"""Persist visual drafts inside the tenant-scoped project, with revision control."""
from fastapi import APIRouter, HTTPException
from pymongo import ReturnDocument

from app.api.deps import CurrentScope
from app.api.routers.projects import get_project_doc
from app.core.clock import utcnow
from app.core.db import get_db
from app.models import project as project_model
from app.schemas.study import StudyIn, StudyOut

router = APIRouter()


@router.get("/projects/{project_id}/study", response_model=StudyOut)
async def get_study(project_id: str, scope: CurrentScope):
    project = await get_project_doc(scope, project_id)
    return project.get("visual_study") or StudyOut()


@router.put("/projects/{project_id}/study", response_model=StudyOut)
async def save_study(project_id: str, payload: StudyIn, scope: CurrentScope):
    project = await get_project_doc(scope, project_id)
    if payload.photos:
        from bson import ObjectId
        ids = [ObjectId(photo.photo_id) for photo in payload.photos]
        photos = await get_db()["photos"].find(scope.filter(
            _id={"$in": ids}, project_id=project_id, deleted_at=None)).to_list(length=100)
        if len(photos) != len(ids):
            raise HTTPException(422, "O estudo contém fotografias indisponíveis neste projeto.")
        sizes = {str(photo["_id"]): photo for photo in photos}
        # Reject coordinates outside the actual original, not just the canvas.
        from app.api.routers.photos import original_dimensions
        for photo in payload.photos:
            doc = sizes[photo.photo_id]
            # Dimensions were already validated on upload; legacy docs may lack them.
            width, height = original_dimensions(doc)
            if any(p.x < 0 or p.y < 0 or p.x > width or p.y > height
                   for surface in photo.surfaces for p in surface.points):
                raise HTTPException(422, "Contorno fora dos limites da fotografia.")
    condition = scope.filter(_id=project["_id"])
    if payload.revision == 0:
        condition["$or"] = [{"visual_study": {"$exists": False}}, {"visual_study.revision": 0}]
    else:
        condition["visual_study.revision"] = payload.revision
    state = payload.model_dump()
    state.update(revision=payload.revision + 1, updated_at=utcnow())
    saved = await get_db()[project_model.COLLECTION].find_one_and_update(
        condition, {"$set": {"visual_study": state, "updated_at": state["updated_at"]}},
        return_document=ReturnDocument.AFTER,
    )
    if saved is None:
        raise HTTPException(409, "Este estudo foi alterado em outra sessão. Baixe sua cópia antes de recarregar.")
    return saved["visual_study"]
