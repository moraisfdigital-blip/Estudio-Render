"""Validated visual drafts. A study never changes measured domain records."""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(max_length=200)]
Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Coordinate = Annotated[float, Field(ge=-100000, le=100000, allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StudyPoint(StrictModel):
    x: Coordinate
    y: Coordinate


class StudyElement(StrictModel):
    name: Text
    type: Text
    width: Annotated[float, Field(gt=0, le=1000, allow_inf_nan=False)]
    height: Annotated[float, Field(gt=0, le=1000, allow_inf_nan=False)]
    x: Coordinate
    y: Coordinate
    color: Color
    material: Text
    finish: Text
    label: Text
    # This is a visual draft flag, never a domain measurement confirmation.
    confirmed: bool = False
    estimated: bool = True
    record_id: Annotated[str, Field(pattern=r"^[0-9a-f]{24}$")] | None = None


class StudySurface(StrictModel):
    id: Text
    name: Text
    points: Annotated[list[StudyPoint], Field(min_length=3, max_length=100)]
    material: Text
    finish: Text
    color: Color
    colorName: Text
    opacity: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
    preserveOpenings: bool = True


class StudyPhoto(StrictModel):
    photo_id: Annotated[str, Field(pattern=r"^[0-9a-f]{24}$")]
    objects: Annotated[list[StudyElement], Field(max_length=100)] = []
    surfaces: Annotated[list[StudySurface], Field(max_length=100)] = []


class StudyIn(StrictModel):
    revision: Annotated[int, Field(ge=0)] = 0
    objects: Annotated[list[StudyElement], Field(max_length=100)] = []
    photos: Annotated[list[StudyPhoto], Field(max_length=100)] = []
    light_mode: Literal["day", "night"] = "day"
    overlay_opacity: Annotated[int, Field(ge=20, le=100)] = 82
    active_photo_id: str | None = None

    @model_validator(mode="after")
    def bounded(self):
        ids = [photo.photo_id for photo in self.photos]
        if len(ids) != len(set(ids)):
            raise ValueError("Uma fotografia não pode aparecer duas vezes no estudo.")
        if self.active_photo_id is not None and self.active_photo_id not in ids:
            raise ValueError("A fotografia selecionada precisa pertencer ao estudo.")
        if len(self.model_dump_json().encode()) > 2_000_000:
            raise ValueError("Estudo muito grande. Divida-o em mais projetos.")
        return self


class StudyOut(StudyIn):
    updated_at: datetime | None = None
