/**
 * Plugin to handle workspace/applyEdit requests from LSP server
 * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_applyEdit
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  // ILSPFeatureManager,
  ILSPDocumentConnectionManager
  // WidgetLSPAdapter
} from '@jupyterlab/lsp';
import { INotebookTracker } from '@jupyterlab/notebook';
4;
import * as lsProtocol from 'vscode-languageserver-protocol';
import type { MessageConnection } from 'vscode-ws-jsonrpc';

// import { EditApplicator, IEditOutcome } from '../edits';
import { PLUGIN_ID } from '../../tokens';
import {
  /*EditApplicator,*/ EditApplicator,
  toDocumentChanges
} from '../../edits';

const METHOD = 'workspace/applyEdit';

function getTextDocumentEdits(
  edit: lsProtocol.WorkspaceEdit
): lsProtocol.TextDocumentEdit[] {
  let textDocumentEdits: lsProtocol.TextDocumentEdit[] = [];
  if (edit.documentChanges) {
    textDocumentEdits = edit.documentChanges.filter(
      (value: lsProtocol.TextDocumentEdit) => value.edits && value.textDocument
    ) as lsProtocol.TextDocumentEdit[];
  } else if (edit.changes) {
    textDocumentEdits = toDocumentChanges(edit.changes);
  }
  return textDocumentEdits;
}

function applyTextDocumentEdit(
  textDocumentEdit: lsProtocol.TextDocumentEdit,
  connectionManager: ILSPDocumentConnectionManager
) {
  const uri = textDocumentEdit.textDocument.uri;
  const adapter = [...connectionManager.adapters.values()].find(
    value => value.virtualDocument?.documentInfo.uri === uri
  );
  if (!adapter || !adapter.virtualDocument) return;
  // @ts-ignore
  const applicator = new EditApplicator(adapter.virtualDocument, adapter);
  applicator.applyEdit({ documentChanges: [textDocumentEdit] });
}

export const WORKSPACE_APPLYEDIT: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID + ':handlers/workspace/applyEdit',
  requires: [INotebookTracker, ILSPDocumentConnectionManager],
  autoStart: true,
  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    connectionManager: ILSPDocumentConnectionManager
  ) => {
    tracker.widgetAdded.connect((_, notebook) => {
      const adapter = connectionManager.adapters.get(notebook.context.path);
      if (!adapter) return;
      adapter.ready.then(() => {
        const virtualDocument = adapter.virtualDocument;
        if (!virtualDocument) return;
        const connection = connectionManager.connections.get(
          virtualDocument.uri
        );
        if (!connection) return;
        connection.serverInitialized.connect(
          (_, serverCapabilities: lsProtocol.ServerCapabilities) => {
            if (
              !serverCapabilities.executeCommandProvider ||
              serverCapabilities.executeCommandProvider.commands.length === 0
            )
              return;
            ((connection as any).connection as MessageConnection).onRequest(
              METHOD,
              ({ edit }: lsProtocol.ApplyWorkspaceEditParams) => {
                // only support edits for v1
                getTextDocumentEdits(edit).forEach(
                  (textDocumentEdit: lsProtocol.TextDocumentEdit) => {
                    applyTextDocumentEdit(textDocumentEdit, connectionManager);
                  }
                );
              }
            );
          }
        );
      });
    });
  }
};
