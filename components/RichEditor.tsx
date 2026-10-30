"use client";
// A Notion-like editor for a note: headings, bold and italic, bullet and numbered lists, checklists. Type the way you
// would in Notion ("# " heading, "- " bullet, "1. " numbered, "[] " checklist, ⌘B bold) or use the toolbar. The note is
// kept as Markdown, so it stays plain text for the AI and for search. ⌘↵ saves.
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "tiptap-markdown";

type Props = {
  value: string;                      // Markdown
  onChange: (md: string) => void;
  placeholder?: string;
  onSubmit?: () => void;              // ⌘↵ / Ctrl↵
  readOnly?: boolean;
  toolbar?: boolean;
  className?: string;
  minHeight?: number;
};
export type RichEditorHandle = { focus: () => void };

/** The editor's Markdown. Checklist items are written "- [ ]" and bullets "* ", so a list followed by a checklist
 * reads back as two lists (Markdown joins neighbouring lists that use the same marker). */
const md = (e: Editor) => (e.storage.markdown.getMarkdown() as string)
  .replace(/^(\s*)\* \[( |x|X)\]/gm, "$1- [$2]").replace(/\\\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();  // line breaks as plain new lines

const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, onChange, placeholder = "", onSubmit, readOnly = false, toolbar = true, className = "", minHeight = 64 }, ref) {
  const editor = useEditor({
    immediatelyRender: false,  // Next renders on the server first
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false, blockquote: false, horizontalRule: false }),
      TaskList, TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: "*", linkify: false, breaks: true, transformPastedText: true }),
    ],
    content: value,
    editable: !readOnly,
    editorProps: {
      attributes: { class: `rich-editor outline-none ${className}`, style: `min-height:${minHeight}px`, "aria-label": "Note text", "aria-multiline": "true", role: "textbox" },
      handleKeyDown: (_v, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { onSubmit?.(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChange(md(e)),
  });
  // Text set from outside (a transcript arriving, the draft cleared after saving) replaces what's shown.
  useEffect(() => {
    if (editor && value !== md(editor)) editor.commands.setContent(value, false);
  }, [value, editor]);
  useEffect(() => { editor?.setEditable(!readOnly); }, [readOnly, editor]);
  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus("end") }), [editor]);

  if (!editor) return <div style={{ minHeight }} />;
  return (
    <div>
      {toolbar && !readOnly && (
        <div className="flex items-center gap-0.5 mb-1.5 -ml-1" role="toolbar" aria-label="Formatting">
          <ToolButton label="Heading" active={editor.isActive("heading", { level: 2 })} run={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H</ToolButton>
          <ToolButton label="Bold (⌘B)" active={editor.isActive("bold")} run={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolButton>
          <ToolButton label="Italic (⌘I)" active={editor.isActive("italic")} run={() => editor.chain().focus().toggleItalic().run()}><i className="font-serif">I</i></ToolButton>
          <span className="w-px h-4 bg-line mx-1" aria-hidden />
          <ToolButton label="Bullet list" active={editor.isActive("bulletList")} run={() => editor.chain().focus().toggleBulletList().run()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg></ToolButton>
          <ToolButton label="Numbered list" active={editor.isActive("orderedList")} run={() => editor.chain().focus().toggleOrderedList().run()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1v4M4 9h2" strokeWidth="1.6" /><path d="M4 14.5c0-.8 2-1 2 0 0 .8-2 1.5-2 3h2" strokeWidth="1.6" /></svg></ToolButton>
          <ToolButton label="Checklist" active={editor.isActive("taskList")} run={() => editor.chain().focus().toggleTaskList().run()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="6" height="6" rx="1.5" /><path d="m4.5 7 1.2 1.2L8 6" /><rect x="3" y="14" width="6" height="6" rx="1.5" /><path d="M13 7h8M13 17h8" /></svg></ToolButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
});

export default RichEditor;

/** One toolbar button; it acts on mouse-down so the text keeps its selection. */
function ToolButton({ label, active, run, children }: { label: string; active: boolean; run: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); run(); }} aria-label={label} title={label} aria-pressed={active}
      className={`h-7 min-w-7 px-1.5 rounded-md text-[13px] font-semibold inline-flex items-center justify-center transition-colors ${active ? "bg-primary-50 text-primary" : "text-muted hover:text-ink hover:bg-surface"}`}>{children}</button>
  );
}
