import io

import numpy as np
import pytest
from PIL import Image

from services.faces import bank, store


@pytest.fixture
def bank_root(tmp_path, monkeypatch):
    """Keep datasets and character profiles out of real user data."""
    monkeypatch.setattr(store, "ROOT", tmp_path / "face_datasets")
    monkeypatch.setattr(bank, "ROOT", tmp_path / "face_bank")
    return tmp_path


def unit(values):
    vector = np.zeros(store.DIMENSIONS, dtype=np.float32)
    for index, value in enumerate(values):
        vector[index] = value
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def seed(name, vectors, sharpness=None):
    """A dataset whose faces carry exactly the embeddings a test needs."""
    import uuid
    dataset = store.create_dataset(name)
    records, embeddings = [], []
    for index, vector in enumerate(vectors):
        # Globally unique, as the pipeline's uuid4 ids are: the bank keys
        # members by face id, so a fixture must not manufacture collisions.
        face_id = uuid.uuid4().hex
        records.append({
            "id": face_id, "source": {"kind": "inline"}, "source_name": f"{name}-{index}.png",
            "source_sha256": f"{index:064x}", "source_width": 100, "source_height": 100,
            "face_index": index, "box": [0, 0, 50, 50], "landmarks": [], "crop_rect": [0, 0, 50, 50],
            "crop_mode": "head", "padding": 0.0, "size": 512,
            "metrics": {"confidence": 0.9, "face_width": 50, "face_height": 50,
                        "crop_width": 50, "crop_height": 50,
                        "sharpness": (sharpness or [50] * len(vectors))[index]},
            "flags": [], "state": "accepted", "cluster": None, "outlier": False,
            "duplicate_of": None, "created_at": store.now(),
        })
        embeddings.append(np.asarray(vector, dtype=np.float32))
        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), (index * 20 % 255, 40, 60)).save(buffer, format="PNG")
        (store.dataset_dir(dataset["id"]) / "crops").mkdir(parents=True, exist_ok=True)
        (store.dataset_dir(dataset["id"]) / "crops" / f"{face_id}.png").write_bytes(buffer.getvalue())
    store.add_faces(dataset["id"], records, embeddings,
                    {"sha256": "a" * 64, "name": name, "width": 100, "height": 100,
                     "source": {"kind": "inline"}, "added_at": store.now()})
    return dataset["id"], [record["id"] for record in records]


# --- profiles ------------------------------------------------------------

def test_a_character_references_dataset_faces_without_copying_crops(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0.1]), unit([1, 0.2])])
    character = bank.create_character("Mara", dataset_id, face_ids, notes="lead", tags=["hero", "hero"])
    assert character["name"] == "Mara"
    assert character["tags"] == ["hero"]
    assert [member["face_id"] for member in character["members"]] == face_ids
    assert all(member["dataset_id"] == dataset_id for member in character["members"])
    # Crops still live only in the dataset; the bank stores no image files.
    assert not list((bank.ROOT).glob("*.png"))
    assert store.crop_path(dataset_id, face_ids[0]).is_file()


def test_names_are_unique_and_validated(bank_root):
    dataset_id, face_ids = seed("a", [unit([1])])
    bank.create_character("Solo", dataset_id, face_ids)
    with pytest.raises(ValueError, match="already has that name"):
        bank.create_character("solo", dataset_id, face_ids)
    with pytest.raises(ValueError):
        bank.create_character("   ", dataset_id, face_ids)


def test_listing_reports_reference_counts_like_the_face_bank_screen(bank_root):
    first, first_faces = seed("a", [unit([1, 0.1]), unit([1, 0.2]), unit([1, 0.3])])
    second, second_faces = seed("b", [unit([0, 1])])
    bank.create_character("Character A", first, first_faces)
    bank.create_character("Character B", second, second_faces)
    listed = {item["name"]: item for item in bank.list_characters()}
    assert listed["Character A"]["reference_count"] == 3
    assert listed["Character B"]["reference_count"] == 1
    assert listed["Character A"]["representative_face_id"] in first_faces


# --- centroid ------------------------------------------------------------

def test_centroid_is_the_renormalized_mean_of_unit_embeddings(bank_root):
    vectors = [unit([1, 0]), unit([0, 1])]
    centroid = bank.compute_centroid(vectors)
    assert centroid["usable"] is True
    assert centroid["source_count"] == 2
    got = np.asarray(centroid["vector"], dtype=np.float32)
    assert float(np.linalg.norm(got)) == pytest.approx(1.0, abs=1e-4)
    expected = unit([1, 1])
    assert float(got @ expected) == pytest.approx(1.0, abs=1e-4)


def test_coherence_is_higher_for_a_tight_group(bank_root):
    tight = bank.compute_centroid([unit([1, 0.02]), unit([1, 0.04]), unit([1, 0.03])])
    loose = bank.compute_centroid([unit([1, 0]), unit([0.3, 1]), unit([1, 0.9])])
    assert tight["coherence"] > loose["coherence"]


def test_a_group_with_no_meaningful_centre_is_reported_not_invented(bank_root):
    # Opposite directions cancel: there is no centre to point at.
    centroid = bank.compute_centroid([unit([1, 0]), -unit([1, 0])])
    assert centroid["usable"] is False
    assert centroid["vector"] is None
    assert "too many directions" in centroid["detail"]


def test_empty_group_has_no_centroid(bank_root):
    assert bank.compute_centroid([]) is None


def test_centroid_ignores_rejected_faces(bank_root):
    dataset_id, face_ids = seed("mixed", [unit([1, 0]), unit([1, 0.05]), unit([0, 1])])
    character = bank.create_character("Drifting", dataset_id, face_ids)
    before = character["centroid"]["coherence"]
    bank.set_member_state(character["id"], [face_ids[2]], "rejected")
    after = bank.get_character(character["id"])
    assert after["centroid"]["source_count"] == 2
    assert after["centroid"]["coherence"] > before


# --- representative face -------------------------------------------------

def test_the_representative_face_is_a_real_existing_crop(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.05]), unit([1, 0.9])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    chosen = character["representative_face_id"]
    assert chosen in face_ids
    # It resolves to a crop that exists on disk: nothing is synthesized.
    assert store.crop_path(dataset_id, chosen).is_file()
    # The odd one out is not the representative.
    assert chosen != face_ids[2]


def test_the_representative_moves_when_the_group_is_curated(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.02]), unit([0, 1]), unit([0, 1.02])])
    character = bank.create_character("Two sides", dataset_id, face_ids)
    bank.set_member_state(character["id"], face_ids[:2], "rejected")
    after = bank.get_character(character["id"])
    assert after["representative_face_id"] in face_ids[2:]


# --- outliers and ordering ----------------------------------------------

def test_members_can_be_ordered_most_to_least_representative(bank_root):
    # Three faces spread along one axis. The most representative is the one
    # nearest the group's centre, not the first or the most extreme.
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.3]), unit([1, 0.8])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    ranked = sorted(character["members"], key=lambda member: -member["similarity"])
    assert ranked[0]["face_id"] == face_ids[1]
    assert ranked[-1]["face_id"] == face_ids[2]
    assert ranked[0]["similarity"] > ranked[-1]["similarity"]
    assert character["representative_face_id"] == face_ids[1]


def test_drifting_faces_are_flagged_but_never_removed(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.02]), unit([1, 0.03]),
                                          unit([1, 0.01]), unit([0.2, 1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    drifting = [member for member in character["members"] if member["drift"]]
    assert [member["face_id"] for member in drifting] == [face_ids[4]]
    # Flagging is advisory: every member is still present and still accepted.
    assert len(character["members"]) == 5
    assert all(member["state"] == "accepted" for member in character["members"])


# --- curation ------------------------------------------------------------

def test_rejecting_keeps_the_face_so_it_can_be_restored(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    bank.set_member_state(character["id"], [face_ids[1]], "rejected")
    rejected = bank.get_character(character["id"])
    assert len(rejected["members"]) == 2
    assert [m["state"] for m in rejected["members"]] == ["accepted", "rejected"]
    bank.set_member_state(character["id"], [face_ids[1]], "accepted")
    assert all(m["state"] == "accepted" for m in bank.get_character(character["id"])["members"])


def test_rejected_faces_are_still_scored_so_restoring_is_an_informed_choice(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.02]), unit([0.4, 1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    bank.set_member_state(character["id"], [face_ids[2]], "rejected")
    loaded = bank.get_character(character["id"])
    rejected = next(m for m in loaded["members"] if m["face_id"] == face_ids[2])
    # It is excluded from the centroid but still measured against it.
    assert loaded["centroid"]["source_count"] == 2
    assert rejected["similarity"] is not None
    assert rejected["similarity"] < min(m["similarity"] for m in loaded["members"] if m["state"] == "accepted")


def test_faces_can_be_moved_between_characters(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([0, 1])])
    first = bank.create_character("Mara", dataset_id, face_ids)
    second = bank.create_character("Other", dataset_id, [])
    result = bank.move_members(first["id"], second["id"], [face_ids[1]])
    assert result["moved"] == 1
    assert [m["face_id"] for m in bank.get_character(first["id"])["members"]] == [face_ids[0]]
    assert [m["face_id"] for m in bank.get_character(second["id"])["members"]] == [face_ids[1]]


def test_moving_into_the_same_character_is_refused(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    with pytest.raises(ValueError, match="different character"):
        bank.move_members(character["id"], character["id"], face_ids)


def test_members_from_a_second_dataset_join_one_character(bank_root):
    first, first_faces = seed("session-one", [unit([1, 0])])
    second, second_faces = seed("session-two", [unit([1, 0.05])])
    character = bank.create_character("Mara", first, first_faces)
    bank.add_members(character["id"], second, second_faces)
    loaded = bank.get_character(character["id"])
    assert {member["dataset_id"] for member in loaded["members"]} == {first, second}
    assert loaded["centroid"]["source_count"] == 2


def test_a_face_deleted_from_its_dataset_is_reported_not_crashed_on(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    store.remove_faces(dataset_id, [face_ids[0]])
    loaded = bank.get_character(character["id"])
    assert loaded["missing_members"] == [{"dataset_id": dataset_id, "face_id": face_ids[0]}]
    assert loaded["centroid"]["source_count"] == 1
    assert loaded["representative_face_id"] == face_ids[1]


# --- references ----------------------------------------------------------

def test_primary_and_additional_references_are_separate_from_the_representative(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.02]), unit([1, 0.5])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    computed = character["representative_face_id"]
    chosen = next(face_id for face_id in face_ids if face_id != computed)
    updated = bank.set_reference(character["id"], chosen, "primary")
    assert updated["primary_reference"] == chosen
    # The human choice does not overwrite the computed one.
    assert updated["representative_face_id"] == computed
    with_extra = bank.set_reference(character["id"], computed, "additional")
    assert with_extra["additional_references"] == [computed]
    cleared = bank.set_reference(character["id"], chosen, "none")
    assert cleared["primary_reference"] is None


def test_a_rejected_face_cannot_stand_as_a_reference(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    bank.set_reference(character["id"], face_ids[1], "primary")
    bank.set_member_state(character["id"], [face_ids[1]], "rejected")
    assert bank.get_character(character["id"])["primary_reference"] is None
    with pytest.raises(ValueError, match="Accept a face"):
        bank.set_reference(character["id"], face_ids[1], "primary")


def test_removing_a_member_clears_it_from_references(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    bank.set_reference(character["id"], face_ids[0], "primary")
    bank.remove_members(character["id"], [face_ids[0]])
    assert bank.get_character(character["id"])["primary_reference"] is None


# --- persistence and the generation-facing read model --------------------

def test_profiles_survive_a_reload(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.1])])
    character = bank.create_character("Mara", dataset_id, face_ids, notes="the lead", tags=["hero"])
    bank.set_reference(character["id"], face_ids[0], "primary")
    again = bank.get_character(character["id"])
    assert again["notes"] == "the lead" and again["tags"] == ["hero"]
    assert again["primary_reference"] == face_ids[0]
    assert again["centroid"]["usable"] is True
    assert [item["name"] for item in bank.list_characters()] == ["Mara"]


def test_identity_bundle_gives_generation_what_it_needs_and_nothing_more(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.02]), unit([1, 0.4])])
    character = bank.create_character("Mara", dataset_id, face_ids, tags=["lead"])
    bank.set_reference(character["id"], face_ids[2], "primary")
    bundle = bank.reference_bundle(character["id"])
    assert bundle["name"] == "Mara" and bundle["tags"] == ["lead"]
    assert bundle["reference_count"] == 3
    assert bundle["representative"]["crop_url"].startswith(f"/faces/datasets/{dataset_id}/faces/")
    assert bundle["primary_reference"]["face_id"] == face_ids[2]
    assert len(bundle["embedding"]["centroid"]) == store.DIMENSIONS
    assert bundle["embedding"]["model"] == "arcface-w600k-r50"
    # Ranked most representative first, so a consumer can take the top N.
    scores = [item["similarity"] for item in bundle["ranked_references"]]
    assert scores == sorted(scores, reverse=True)
    assert "not a confirmed identity" in bundle["caveat"]


def test_deleting_a_character_leaves_the_dataset_untouched(bank_root):
    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.1])])
    character = bank.create_character("Mara", dataset_id, face_ids)
    bank.delete_character(character["id"])
    assert bank.list_characters() == []
    assert len(store.get_dataset(dataset_id)["faces"]) == 2
    assert store.crop_path(dataset_id, face_ids[0]).is_file()


# --- routes --------------------------------------------------------------

def test_character_routes_cover_the_bank_workflow(bank_root):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.faces import router

    dataset_id, face_ids = seed("shoot", [unit([1, 0]), unit([1, 0.03]), unit([1, 0.6])])
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        created = client.post("/faces/characters", json={
            "name": "Mara", "dataset_id": dataset_id, "face_ids": face_ids,
            "notes": "lead", "tags": ["hero"]}).json()
        character_id = created["id"]

        listed = client.get("/faces/characters").json()["characters"]
        assert listed[0]["reference_count"] == 3

        loaded = client.get(f"/faces/characters/{character_id}").json()
        assert loaded["representative_face_id"] in face_ids
        assert loaded["centroid"]["usable"] is True

        assert client.post(f"/faces/characters/{character_id}/members/state",
                           json={"face_ids": [face_ids[2]], "state": "rejected"}).json()["changed"] == 1
        assert client.post(f"/faces/characters/{character_id}/reference",
                           json={"face_id": face_ids[0], "role": "primary"}).json()["primary_reference"] == face_ids[0]

        bundle = client.get(f"/faces/characters/{character_id}/identity").json()
        assert bundle["reference_count"] == 2
        assert bundle["primary_reference"]["face_id"] == face_ids[0]

        edited = client.put(f"/faces/characters/{character_id}",
                            json={"notes": "updated", "tags": ["hero", "lead"]}).json()
        assert edited["notes"] == "updated" and edited["tags"] == ["hero", "lead"]

        assert client.delete(f"/faces/characters/{character_id}").json()["deleted"] is True
        assert client.get(f"/faces/characters/{character_id}").status_code == 400
        # The dataset the character was built from is untouched.
        assert client.get(f"/faces/datasets/{dataset_id}").status_code == 200
