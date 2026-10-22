// src/constants/familias.js
//
// Reexportación de la FUENTE CANÓNICA única de familias, que vive en
// supabase/functions/_shared/familias.js (ESM puro, compartido por app,
// scripts y Edge Functions). No definir familias aquí: solo reexportar.

export * from '../../supabase/functions/_shared/familias.js';
