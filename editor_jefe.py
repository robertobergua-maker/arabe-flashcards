import os
import re
import json
import time
from supabase import create_client, Client
from openai import OpenAI

# --- TUS CREDENCIALES DE SUPABASE ---
# (La de OpenAI se leerá del sistema, no la escribas aquí)
SUPABASE_URL = "https://ggecznwbxpwybxmvmuog.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZWN6bndieHB3eWJ4bXZtdW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQ5NjgxNSwiZXhwIjoyMDgyMDcyODE1fQ.S6QqKdHfDozJr7FDeV90T2Em_nxwR0cUcjSHbBT1kxc" 

# --- CONFIGURACIÓN ---
MODELO_IA = "gpt-4o"

# --- EXCEPCIONES DE NUNACIÓN ---
EXCEPTIONS = [
    "شكراً", "جداً", "أبداً", "حالاً", "طبعاً", "عموماً", 
    "يومياً", "مثلاً", "فعلاً", "تقريباً", "أهلاً", "سهلاً",
    "دائماً", "غالباً", "أحياناً", "قليلاً"
]

def get_openai_client():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("❌ ERROR: No se encontró la variable de entorno 'OPENAI_API_KEY'.")
        print("   Por favor, añádela en Windows o configúrala antes de ejecutar.")
        return None
    return OpenAI(api_key=api_key)

def clean_nunation(text):
    if not text: return ""
    words = text.split()
    cleaned_words = []
    tanwin_pattern = re.compile(r'[\u064B\u064C\u064D]+$')
    for word in words:
        clean = word.replace(".", "").replace("،", "")
        if any(ex in clean for ex in EXCEPTIONS):
            cleaned_words.append(word)
        else:
            cleaned_words.append(tanwin_pattern.sub('', word))
    return " ".join(cleaned_words)

# --- INTERFAZ GRÁFICA DE CONSOLA ---
def print_separator():
    print("-" * 80)

def print_card_window(card, title="DETALLES DE LA TARJETA"):
    """Dibuja una 'ventana' con los datos de la tarjeta"""
    print("\n" + "="*60)
    print(f" 📇 {title} (ID: {card['id']})")
    print("="*60)
    print(f"  🇸🇦 ÁRABE:    {card.get('arabic', '')}")
    print(f"  🇪🇸 ESPAÑOL:  {card.get('spanish', '')}")
    print(f"  🏷️  CATEGORÍA: {card.get('category', '')}")
    print(f"  🗣️  FONÉTICA:  {card.get('phonetic', '')}")
    print("="*60 + "\n")

def edit_card_interactive(card, supabase):
    """Menú interactivo para editar cualquier campo"""
    while True:
        print_card_window(card, "MODO EDICIÓN")
        print("¿Qué quieres modificar?")
        print(" [1] Editar Árabe")
        print(" [2] Editar Español")
        print(" [3] Editar Categoría")
        print(" [4] Editar Fonética")
        print(" [G] Guardar y Salir")
        print(" [C] Cancelar cambios")
        
        op = input("👉 Opción: ").upper().strip()
        
        if op == '1': card['arabic'] = input(f"   Nuevo Árabe ({card['arabic']}): ") or card['arabic']
        elif op == '2': card['spanish'] = input(f"   Nuevo Español ({card['spanish']}): ") or card['spanish']
        elif op == '3': card['category'] = input(f"   Nueva Categoría ({card['category']}): ") or card['category']
        elif op == '4': card['phonetic'] = input(f"   Nueva Fonética ({card['phonetic']}): ") or card['phonetic']
        elif op == 'G':
            # Guardar en BD
            supabase.table("flashcards").update({
                "arabic": card['arabic'],
                "spanish": card['spanish'],
                "category": card['category'],
                "phonetic": card['phonetic']
            }).eq("id", card['id']).execute()
            print("💾 ¡Cambios guardados!")
            return True
        elif op == 'C':
            print("❌ Edición cancelada.")
            return False

def audit_batch_with_ai(client_ai, cards_batch):
    mini_cards = [{"id": c["id"], "arabic": c["arabic"], "spanish": c["spanish"], "category": c["category"]} for c in cards_batch]
    prompt = f"""
    Eres un editor experto de diccionarios árabe-español. Revisa estas entradas.
    Busca:
    1. Errores de traducción graves.
    2. Inconsistencias (ej: Categoría 'Animales' pero la palabra es 'Coche').
    3. Errores tipográficos.

    DATOS: {json.dumps(mini_cards, ensure_ascii=False)}

    Devuelve un JSON con los errores encontrados:
    [
        {{
            "id": 123,
            "problem": "Traducción incorrecta / Categoría mal",
            "suggestion": "Valor sugerido correcto",
            "field_to_fix": "spanish" (o "category" o "arabic")
        }}
    ]
    Si todo está bien, devuelve [].
    """
    try:
        response = client_ai.chat.completions.create(
            model=MODELO_IA, messages=[{"role": "user", "content": prompt}], temperature=0.3
        )
        content = response.choices[0].message.content.replace("```json", "").replace("```", "").strip()
        return json.loads(content)
    except Exception:
        return []

# --- PROGRAMA PRINCIPAL ---
def main():
    print("🔌 Iniciando Editor Pro...")
    
    # 1. Conexiones
    client_ai = get_openai_client()
    if not client_ai: return

    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"❌ Error Supabase: {e}"); return

    print("📥 Descargando base de datos...")
    cards = supabase.table("flashcards").select("*").execute().data
    print(f"✅ {len(cards)} tarjetas en memoria.\n")

    # ---------------------------------------------------------
    # FASE 1: LIMPIEZA AUTOMÁTICA (Silenciosa)
    # ---------------------------------------------------------
    print("🧹 Ejecutando limpieza automática de nunaciones...")
    for card in cards:
        limpio = clean_nunation(card.get("arabic", ""))
        if limpio != card.get("arabic", ""):
            supabase.table("flashcards").update({"arabic": limpio}).eq("id", card['id']).execute()
            card['arabic'] = limpio
    print("✅ Limpieza terminada.\n")

    # ---------------------------------------------------------
    # FASE 2: DUPLICADOS (Interfaz Ventana)
    # ---------------------------------------------------------
    print("👀 BUSCANDO DUPLICADOS...")
    grouped = {}
    for c in cards:
        grouped.setdefault(c['arabic'], []).append(c)

    for arabic, group in grouped.items():
        if len(group) > 1:
            print_separator()
            print(f"🔴 CONFLICTO: La palabra '{arabic}' aparece {len(group)} veces.")
            
            # Mostrar todas las versiones
            for c in group:
                print_card_window(c, f"VERSIÓN ID {c['id']}")

            # Menú de acción
            while True:
                print(f"\nOpciones para '{arabic}':")
                print(" [E]scribir el ID de la que quieres SALVAR (se borran las demás)")
                print(" [M]odificar/Editar una específica antes de decidir")
                print(" [S]altar este grupo")
                
                choice = input("👉 Acción: ").strip().upper()

                if choice == 'S': break
                
                # Opción: Salvar una (Borrar resto)
                if choice.isdigit():
                    winner_id = int(choice)
                    winner_card = next((x for x in group if x['id'] == winner_id), None)
                    if winner_card:
                        for c in group:
                            if c['id'] != winner_id:
                                supabase.table("flashcards").delete().eq("id", c['id']).execute()
                                print(f"🗑️ Borrada ID {c['id']}")
                        print("✅ Conflicto resuelto.")
                        break
                    else:
                        print("❌ ID no encontrado en este grupo.")

                # Opción: Editar
                if choice == 'M':
                    edit_id = int(input("   ¿Qué ID quieres editar?: "))
                    target = next((x for x in group if x['id'] == edit_id), None)
                    if target:
                        edit_card_interactive(target, supabase)
                    else:
                        print("❌ ID incorrecto.")

    # ---------------------------------------------------------
    # FASE 3: AUDITORÍA IA (Interfaz Ventana)
    # ---------------------------------------------------------
    print("\n🧠 INICIANDO AUDITORÍA INTELIGENTE...")
    batch_size = 20
    for i in range(0, len(cards), batch_size):
        batch = cards[i:i+batch_size]
        print(f"   🔎 Analizando lote {i}-{i+len(batch)}...")
        
        errors = audit_batch_with_ai(client_ai, batch)
        
        for err in errors:
            card = next((c for c in batch if c['id'] == err['id']), None)
            if not card: continue

            print_card_window(card, "POSIBLE ERROR DETECTADO")
            print(f"⚠️  IA DICE: {err['problem']}")
            print(f"💡 SUGERENCIA: Cambiar '{err['field_to_fix']}' a -> {err['suggestion']}")
            
            while True:
                print("\n¿Qué hacemos?")
                print(" [1] Aceptar sugerencia IA (Automático)")
                print(" [2] Editar manualmente (Abrir editor completo)")
                print(" [3] Borrar esta tarjeta")
                print(" [4] Ignorar / Saltar")
                
                action = input("👉 Decisión: ").strip()
                
                if action == '1':
                    supabase.table("flashcards").update({err['field_to_fix']: err['suggestion']}).eq("id", card['id']).execute()
                    print("✅ Corregido.")
                    break
                elif action == '2':
                    edit_card_interactive(card, supabase)
                    break
                elif action == '3':
                    if input("Seguro? (s/n): ") == 's':
                        supabase.table("flashcards").delete().eq("id", card['id']).execute()
                        print("🗑️ Tarjeta eliminada.")
                    break
                elif action == '4':
                    print("⏭️ Saltado.")
                    break

    print("\n🎉 ¡MANTENIMIENTO FINALIZADO CON ÉXITO!")

if __name__ == "__main__":
    main()