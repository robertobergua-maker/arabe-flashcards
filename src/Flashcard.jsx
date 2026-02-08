export default function Flashcard({
  data,
  frontLanguage,
  showDiacritics,
  isAdmin,
  onDelete,
  onEdit
}) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-sm text-slate-500 mb-2">
        {data.category || "General"}
      </div>

      <div className="font-bold text-lg mb-1">
        {frontLanguage === "spanish" ? data.spanish : data.arabic}
      </div>

      {data.phonetic && (
        <div className="text-sm italic text-slate-400">
          {data.phonetic}
        </div>
      )}

      {isAdmin && (
        <div className="flex gap-2 mt-4">
          <button
            onClick={onEdit}
            className="px-3 py-1 bg-blue-500 text-white rounded"
          >
            Editar
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1 bg-red-500 text-white rounded"
          >
            Borrar
          </button>
        </div>
      )}
    </div>
  );
}
