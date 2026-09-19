# Form 5S photo access contract

## Request

`POST /functions/v1/maturity-drive`

```json
{"action":"download-5s-photo","assessmentId":"M5S-...","photoIndex":0}
```

Only `assessmentId` and integer `photoIndex` are accepted. `storagePath`, `driveFileId`, and UPT name supplied by the caller are ignored/rejected.

## Authorization

1. Resolve the assessment by `id`.
2. Resolve canonical UPT by `assessment.upt_id`.
3. Apply existing UPT/UIT/Pusat read scope.
4. Read the photo metadata at the requested index.
5. Prefer private bucket object from the stored canonical path; fallback to Drive only when legacy metadata has no storage path.

## Response

Binary response with `Content-Type`, `Content-Disposition`, `X-File-Name`, and private cache headers. Errors use existing JSON `{ok:false,error}` shape.
