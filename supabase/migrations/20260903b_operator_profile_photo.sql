-- Foto profil operator (avatar) — melengkapi operator_profile (sio_photo/sia_photo
-- sudah ada). PROPOSAL: file ini TIDAK dieksekusi otomatis, menunggu apply manual user.

alter table operator_profile add column if not exists profile_photo text;
