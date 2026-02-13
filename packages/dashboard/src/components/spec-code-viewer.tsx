'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Code, Pencil, Save, X, Loader2 } from 'lucide-react';

interface SpecCodeViewerProps {
  specId: string;
  code: string;
  projectId: string;
  defaultExpanded?: boolean;
}

export function SpecCodeViewer({ specId, code, projectId, defaultExpanded = false }: SpecCodeViewerProps) {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCode, setEditedCode] = useState('');

  const updateMutation = useMutation({
    mutationFn: (newCode: string) => api.updateTestSpec(specId, newCode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setIsEditing(false);
    },
  });

  const handleEdit = () => {
    setEditedCode(code);
    setIsEditing(true);
    setIsExpanded(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editedCode);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedCode('');
  };

  const lineCount = code.split('\n').length;

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 cursor-pointer"
        onClick={() => !isEditing && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Code className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-xs text-zinc-400">{lineCount} lines</span>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                className="flex items-center px-2 py-0.5 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                <X className="h-3 w-3 mr-1" />
                Cancel
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleSave(); }}
                disabled={updateMutation.isPending}
                className="flex items-center px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                Save
              </button>
            </>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); handleEdit(); }}
              className="flex items-center px-2 py-0.5 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        isEditing ? (
          <textarea
            value={editedCode}
            onChange={(e) => setEditedCode(e.target.value)}
            className="w-full h-80 p-3 bg-zinc-950 text-zinc-300 font-mono text-xs focus:outline-none resize-none border-t border-zinc-700"
            spellCheck={false}
          />
        ) : (
          <div className="max-h-80 overflow-auto">
            <SyntaxHighlighter
              language="typescript"
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '0.75rem',
                background: 'transparent',
                fontSize: '0.75rem',
              }}
              showLineNumbers
            >
              {code}
            </SyntaxHighlighter>
          </div>
        )
      )}

      {updateMutation.isError && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-500/5 border-t border-zinc-700">
          {(updateMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
