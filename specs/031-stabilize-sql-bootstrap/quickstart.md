# Quickstart Validation

1. `node --test tests/unit/schemaBootstrap.contract.test.mjs`
2. `node scripts/rehearse_schema_bootstrap.mjs`
3. `npm test`
4. `npm run build`

Expected: seluruh perintah exit 0; bootstrap scratch dapat dijalankan dua kali; production tidak disentuh.
