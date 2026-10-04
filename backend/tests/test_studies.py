"""Visual study survives a reload without granting measurement/tenant privileges."""
from copy import deepcopy


def draft(photo_id):
    return {"revision": 0, "photos": [{"photo_id": photo_id, "objects": [], "surfaces": [{
        "id": "surface-1", "name": "Testeira", "points": [
            {"x": 20, "y": 20}, {"x": 100, "y": 20}, {"x": 100, "y": 100}],
        "material": "ACM", "finish": "Fosco", "color": "#112233", "colorName": "Estudo",
        "opacity": 80, "preserveOpenings": True,
    }]}], "active_photo_id": photo_id}


async def test_study_roundtrip_and_tenant_stamp(api, owner, levantamento, banco):
    path = f"/api/projects/{levantamento.projeto_id}/study"
    assert (await api.get(path, headers=owner.auth)).json()["revision"] == 0
    response = await api.put(path, headers=owner.auth, json=draft(levantamento.foto_id))
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["revision"] == 1
    assert (await api.get(path, headers=owner.auth)).json() == saved
    from bson import ObjectId
    doc = await banco.projects.find_one({"_id": ObjectId(levantamento.projeto_id)})
    assert doc["tenant_id"] == owner.tenant_id
    assert doc["visual_study"]["photos"][0]["surfaces"][0]["color"] == "#112233"
    assert await banco.elements.count_documents({"photo_id": levantamento.foto_id}) == 0


async def test_stale_session_cannot_overwrite(api, owner, levantamento):
    path = f"/api/projects/{levantamento.projeto_id}/study"
    payload = draft(levantamento.foto_id)
    assert (await api.put(path, headers=owner.auth, json=payload)).status_code == 200
    assert (await api.put(path, headers=owner.auth, json=payload)).status_code == 409
    payload["revision"] = 1
    assert (await api.put(path, headers=owner.auth, json=payload)).json()["revision"] == 2


async def test_study_requires_auth_and_cannot_accept_other_photos(api, owner, levantamento):
    path = f"/api/projects/{levantamento.projeto_id}/study"
    assert (await api.get(path)).status_code == 401
    payload = draft("012345678901234567890123")
    assert (await api.put(path, headers=owner.auth, json=payload)).status_code == 422
    assert (await api.put(path, headers=owner.auth, json={"tenant_id": "intruso"})).status_code == 422


async def test_study_rejects_script_colors_and_invalid_geometry(api, owner, levantamento):
    path = f"/api/projects/{levantamento.projeto_id}/study"
    payload = draft(levantamento.foto_id)
    attack = deepcopy(payload)
    attack["photos"][0]["surfaces"][0]["color"] = '\"><script>alert(1)</script>'
    assert (await api.put(path, headers=owner.auth, json=attack)).status_code == 422
    payload["photos"][0]["surfaces"][0]["points"][0]["x"] = levantamento.largura + 1
    assert (await api.put(path, headers=owner.auth, json=payload)).status_code == 422


async def test_study_cross_tenant_hidden(api, owner, levantamento, banco):
    from bson import ObjectId
    from app.core.security import create_access_token
    rogue_id = ObjectId()
    await banco.users.insert_one({"_id": rogue_id, "tenant_id": "other-tenant", "role": "owner"})
    token = create_access_token(user_id=str(rogue_id), tenant_id="other-tenant", role="owner")
    headers = {"Authorization": "Bearer " + token}
    path = f"/api/projects/{levantamento.projeto_id}/study"
    assert (await api.get(path, headers=headers)).status_code == 404
    assert (await api.put(path, headers=headers, json={})).status_code == 404
