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
  ILSPDocumentConnectionManager,
  WidgetLSPAdapter
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


interface URIToAdapterMap {
  [key: string]: WidgetLSPAdapter;
}

interface URIToTextDocumentEditsMap {
  [key: string]: lsProtocol.TextDocumentEdit[];
}


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

function getURIToTextDocumentEditsMap(
  textDocumentEdits: lsProtocol.TextDocumentEdit[]
): URIToTextDocumentEditsMap {
  const uriToTextDocumentEditsMap = {} as URIToTextDocumentEditsMap;

  textDocumentEdits.forEach((textDocumentEdit: lsProtocol.TextDocumentEdit) => {
    const { uri } = textDocumentEdit.textDocument;
    if (!uriToTextDocumentEditsMap[uri]) uriToTextDocumentEditsMap[uri] = [];
    uriToTextDocumentEditsMap[uri].push(textDocumentEdit);
  });

  return uriToTextDocumentEditsMap;
}

function getURIToAdapterMap(
  connectionManager: ILSPDocumentConnectionManager
): URIToAdapterMap {
  const uriToAdapterMap = {} as URIToAdapterMap;
  const adapters = [...connectionManager.adapters.values()];
  adapters.forEach((adapter: WidgetLSPAdapter) => {
    const uri = adapter.virtualDocument?.documentInfo.uri;
    if (uri) uriToAdapterMap[uri] = adapter;
  });
  return uriToAdapterMap;
}

function handleApplyEditRequest(
  connectionManager: ILSPDocumentConnectionManager,
  edit: lsProtocol.WorkspaceEdit
) {
  // only support edits for v1
  const uriToAdapterMap = getURIToAdapterMap(connectionManager);
  const uriToTextDocumentEditsMap = getURIToTextDocumentEditsMap(
    getTextDocumentEdits(edit)
  );
  for (let uri in uriToTextDocumentEditsMap) {
    const adapter = uriToAdapterMap[uri];
    const textDocumentEdits = uriToTextDocumentEditsMap[uri];
    if (!adapter || !adapter.virtualDocument) continue;
    const applicator = new EditApplicator(
      // @ts-ignore
      adapter.virtualDocument,
      adapter
    );
    applicator.applyEdit({ documentChanges: textDocumentEdits });
  }
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
        const {virtualDocument} = adapter;
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
              ({ edit }: lsProtocol.ApplyWorkspaceEditParams) =>
                handleApplyEditRequest(connectionManager, edit)
            );
          }
        );
      });
    });
  }
};
