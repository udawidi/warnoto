# Contract: public_attb_material

Input: `p_attb_id text`, `p_token uuid`.

Token salah, record legacy, atau sumber tidak sah: `null`.

Payload sukses:

```json
{
  "trackingCode": "ATTB-TUG10-...",
  "material": { "catalog": "...", "name": "...", "unit": "...", "serial": "...", "assetNo": "..." },
  "source": { "tug10No": "...", "receivedAt": 0 },
  "location": { "upt": "...", "gudang": "...", "subGudang": "...", "blok": "..." },
  "photos": { "overall": "relative/path", "nameplate": "relative/path" },
  "status": "...",
  "timeline": [{ "at": 0, "label": "..." }]
}
```

Tidak boleh memuat actor, nilai, catatan internal, raw data, internal UPT ID, atau URL arbitrer.

