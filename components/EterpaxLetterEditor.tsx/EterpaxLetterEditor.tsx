"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useRef } from "react";
import { useEffect } from "react";
import { useState } from "react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder"; 
  import TextAlign from "@tiptap/extension-text-align";

type EterpaxLetterEditorProps = {
  value: string;
  onChange: (html: string) => void;
};

export default function EterpaxLetterEditor({
  value,
  onChange,
}: EterpaxLetterEditorProps) {
    const savedSelection = useRef<{ from: number; to: number } | null>(null);
    const [showColorPicker, setShowColorPicker] = useState(false);
  const editor = useEditor({
    extensions: [
        StarterKit,
TextStyleKit,
TextAlign.configure({
  types: ["heading", "paragraph"],
}),
Placeholder.configure({
  placeholder: "Dear...\nWrite what you want them to know.",
}),
      ],
    content: value || "<p></p>",
    immediatelyRender: false,
    editorProps: {
        attributes: {
          class: "outline-none focus:outline-none",
        },
      },
    editable: true,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor) {
      editor.commands.focus("start");
    }
  }, [editor]);
  
  if (!editor) {
    return null;
  }
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-slate-700">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              editor.isActive("bold")
                ? "bg-slate-200"
                : "hover:bg-slate-200"
            }`}
          >
            B
          </button>
  
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`rounded-lg px-3 py-2 text-sm italic ${
              editor.isActive("italic")
                ? "bg-slate-200"
                : "hover:bg-slate-200"
            }`}
          >
            I
          </button>
  
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`rounded-lg px-3 py-2 text-sm underline ${
              editor.isActive("underline")
                ? "bg-slate-200"
                : "hover:bg-slate-200"
            }`}
          >
            U
          </button>
  
          <select
          onMouseDown={() => {
            if (editor) {
              savedSelection.current = {
                from: editor.state.selection.from,
                to: editor.state.selection.to,
              };
            }
          }}
            defaultValue=""
            onChange={(event) => {
              const font = event.target.value;
  
              if (font) {
                const chain = editor.chain().focus();
              
                if (savedSelection.current) {
                  chain.setTextSelection(savedSelection.current);
                }
              
                chain.setMark("textStyle", { fontFamily: font }).run();
                savedSelection.current = null;
              }
  
             
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Font</option>
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Times New Roman">
              Times New Roman
            </option>
            <option value="Verdana">Verdana</option>
            <option value="Courier New">Courier New</option>
          </select>
  
          <select
            defaultValue=""
            onChange={(event) => {
              const size = event.target.value;
  
              if (size) {
                editor
                  .chain()
                  .focus()
                  .setFontSize(size)
                  .run();
              }
  
              
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Size</option>
            <option value="12px">12</option>
            <option value="14px">14</option>
            <option value="16px">16</option>
            <option value="18px">18</option>
            <option value="20px">20</option>
            <option value="24px">24</option>
          </select>
  
          <button
  type="button"
  title="Text color"
  onClick={() => setShowColorPicker((current) => !current)}
  className="h-9 w-10 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 text-lg"
>
<span
  className="block h-full w-full rounded-lg border border-slate-300 shadow-sm"
  style={{
    backgroundColor: editor.getAttributes("textStyle").color || "#0F2747",
  }}
/>
</button>
{showColorPicker && (
    <div className="absolute z-50 mt-2 grid grid-cols-6 gap-2.5 rounded-2xl border border-[#D9E4F2] bg-white p-3 shadow-[0_16px_40px_rgba(15,39,71,0.22)]">
    {[
      "#000000",
      "#4B5563",
      "#DC2626",
      "#EA580C",
      "#CA8A04",
      "#16A34A",
      "#2563EB",
      "#7C3AED",
      "#DB2777",
      "#92400E",
      "#0F766E",
      "#FFFFFF",
    ].map((color) => (
      <button
        key={color}
        type="button"
        title={color}
        onClick={() => {
          editor.chain().focus().setColor(color).run();
          setShowColorPicker(false);
        }}
        className="h-8 w-8 rounded-full border-2 border-white shadow-sm transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
      />
    ))}
  </div>
)}
          <div className="h-6 w-px bg-slate-200" />
  
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().setTextAlign("left").run()
            }
            className="rounded-lg px-3 py-2 text-sm hover:bg-slate-200"
          >
            Left
          </button>
  
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().setTextAlign("center").run()
            }
            className="rounded-lg px-3 py-2 text-sm hover:bg-slate-200"
          >
            Center
          </button>
  
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().setTextAlign("right").run()
            }
            className="rounded-lg px-3 py-2 text-sm hover:bg-slate-200"
          >
            Right
          </button>
        </div>
      </div>
  
      <EditorContent
        editor={editor}
        className="min-h-[420px] bg-[linear-gradient(to_right,#FFFDF8_0%,rgba(255,253,248,0.96)_32%,rgba(255,253,248,0.55)_55%,rgba(255,253,248,0)_78%),url('/images/letter-background-v1.png')] bg-cover bg-center px-8 py-8 text-[16px] leading-7 text-slate-700"
      />
    </div>
  );
}