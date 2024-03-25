'use strict';

import * as vscode from 'vscode';

import { DecisionFileExplorer } from './DecisionFileExplorer';

export function activate(context: vscode.ExtensionContext) {

	new DecisionFileExplorer(context);

}