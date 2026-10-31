"""File uploads have no application byte, file-count or form-field ceiling.

Starlette still spools file parts to disk. Its spool threshold controls memory
use; it is not an upload rejection limit. Authentication and route-specific
format/path validation remain owned by the existing routes.
"""
from fastapi import Request
from fastapi.routing import APIRoute


class UploadRequest(Request):
    def form(self, **_options):
        return super().form(max_files=float('inf'), max_fields=float('inf'), max_part_size=float('inf'))


class UploadRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def upload_handler(request):
            return await handler(UploadRequest(request.scope, request.receive))

        return upload_handler
