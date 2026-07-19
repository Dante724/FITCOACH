## TEST AGENT PROMPT – IMAGE INTEGRATION RULES ##
- Always use base64-encoded images for all tests.
- Accepted formats: JPEG, PNG, WEBP only.
- Do not use blank/solid-color images. Every image must contain real visual features.
- If not PNG/JPEG/WEBP, transcode to PNG/JPEG before upload and update MIME.
- If animated, extract first frame only.
- Resize large images to reasonable bounds.

Endpoints to test:
- POST /api/food/analyze  {"description":"2 eggs and toast with butter"}  -> returns calories/macros JSON
- POST /api/bodyscan/analyze {"image_base64":"<b64>"} -> returns body_type + recommendations
