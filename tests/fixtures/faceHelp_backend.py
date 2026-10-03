"""Real review APIs and disposable synthetic photos, without model inference."""
import io
import json
import os

assert 'law-break-room-' in os.environ.get('LAW_DATA_DIR', ''), 'Use the isolated Break Room preview directory.'
import numpy as np
from PIL import Image, ImageDraw
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from routes.visual_review import router as review_router
from routes.image_library import router as library_router
from routes.image_manager import router as manager_router
from services import face_help, image_library, image_manager, visual_review as store
from services.faces.providers import DetectedFace

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5203'], allow_methods=['*'], allow_headers=['*'])
app.include_router(review_router); app.include_router(library_router); app.include_router(manager_router)


def picture(background, size):
    image = Image.new('RGB', (300, 220), background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 158, 300, 220), fill='#29423d')
    for x in range(12, 300, 22): draw.line((x, 0, x + 50, 150), fill='#758a82', width=2)
    left, top = 110, 32
    draw.ellipse((left, top, left + size, top + size), fill='#d6aa82', outline='#725a45', width=2)
    draw.ellipse((left + size*.24, top + size*.37, left + size*.31, top + size*.45), fill='#242d36')
    draw.ellipse((left + size*.68, top + size*.37, left + size*.75, top + size*.45), fill='#242d36')
    draw.arc((left + size*.3, top + size*.55, left + size*.7, top + size*.8), 0, 180, fill='#68483e', width=2)
    draw.rectangle((left, top + size + 8, left + size, 157), fill='#577e9b')
    output = io.BytesIO(); image.save(output, 'PNG')
    return output.getvalue(), (left, top, left + size, top + size)


def seed(name, background, values, size, manager=False):
    raw, box = picture(background, size)
    vector = np.zeros(32); vector[:len(values)] = values; vector /= np.linalg.norm(vector)
    if manager:
        root = settings.data_dir.parent / 'photos'; root.mkdir(exist_ok=True)
        (root / name).write_bytes(raw)
        catalog = image_manager.manager
        folder = catalog.add_folder(str(root))['id']; catalog.start('scan', {'folder_ids': [folder], 'recursive': True}); catalog.worker.join(10)
        identifier = catalog.query(folder_id=folder)['images'][0]['id']; source = 'image-manager'
    else:
        identifier = image_library.import_image(raw, name)['id']; source = 'library'
    _, digest, _ = store.read_source(source, identifier)
    store.add_faces(digest, raw, [DetectedFace(box, .99, embedding=tuple(vector))])
    return store.result(digest)['faces'][0]


ready = settings.data_dir / 'fixture-ready'
if not ready.exists():
    for name, background, values in [('Alex', '#4f6960', [1, 0]), ('Jordan', '#465c79', [0, 1])]:
        face = seed(name + '-reference.png', background, values, 100)
        store.rename_person(face['person_id'], name)
        store.correct_face(face['id'], face['person_id'])
        question = face_help.questions()['question']
        # Previous references were answered, leaving the newly seeded face.
        face_help.answer('all', face['id'], question['version'], 'yes', name, face['person_id'])
    seed('Small indoor photo.png', '#5e6671', [1, 1], 40)
    seed('Outdoor photo.png', '#4d7560', [1, .03], 80, manager=True)
    ready.write_text('synthetic preview only', encoding='utf-8')


@app.get('/fixture/saved')
def saved():
    with store.database() as db:
        faces = [dict(row) for row in db.execute('SELECT f.id,p.name,f.uncertain,f.excluded FROM faces f JOIN people p ON p.id=f.person_id ORDER BY p.name')]
        answers = [json.loads(row['value'])['answer'] for row in db.execute('SELECT value FROM face_feedback')]
    return {'faces': faces, 'answers': answers}
