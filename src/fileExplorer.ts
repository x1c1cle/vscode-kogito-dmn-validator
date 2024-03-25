import * as vscode from 'vscode';
import  {Headers}  from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs';
import * as readFile from 'fs';
import { promisify, TextEncoder } from 'util';
import * as httpm from 'typed-rest-client/HttpClient';
import { Console } from 'console';
import {URI, Utils} from 'vscode-uri';

namespace _ {

	function handleResult<T>(resolve: (result: T) => void, reject: (error: Error) => void, error: Error | null | undefined, result: T): void {
		if (error) {
			reject(massageError(error));
		} else {
			resolve(result);
		}
	}

	function massageError(error: Error & { code?: string }): Error {
		if (error.code === 'ENOENT') {
			return vscode.FileSystemError.FileNotFound();
		}

		if (error.code === 'EISDIR') {
			return vscode.FileSystemError.FileIsADirectory();
		}

		if (error.code === 'EEXIST') {
			return vscode.FileSystemError.FileExists();
		}

		if (error.code === 'EPERM' || error.code === 'EACCESS' || error.code === 'EBUSY') {
			return vscode.FileSystemError.NoPermissions();
		}

		return error;
	}

	export function checkCancellation(token: vscode.CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new Error('Operation cancelled');
		}
	}

	export function normalizeNFC(items: string): string;
	export function normalizeNFC(items: string[]): string[];
	export function normalizeNFC(items: string | string[]): string | string[] {
		if (process.platform !== 'darwin') {
			return items;
		}

		if (Array.isArray(items)) {
			return items.map(item => item.normalize('NFC'));
		}

		return items.normalize('NFC');
	}

	export function readdir(path: string): Promise<string[]> {
		return new Promise<string[]>((resolve, reject) => {
			try {
				fs.readdir(path, (error, children) => handleResult(resolve, reject, error, normalizeNFC(children)));
			} catch (error) {
				console.log(error);
			}
		});
	}

	export function stat(path: string): Promise<fs.Stats> | undefined {

		return new Promise<fs.Stats>((resolve, reject) => {
			try {
				var info = fs.statSync(path);
				return resolve(info);
			} catch (error) {
				return resolve(new fs.Stats())
			}

		});
	}

	export function readfile(path: string): Promise<Buffer> {
		return new Promise<Buffer>((resolve, reject) => {
			fs.readFile(path, (error, buffer) => handleResult(resolve, reject, error, buffer));
		});
	}

	export async function exists(path: string): Promise<boolean> {
		try {
			await promisify(fs.access)(path);
			return true;
		} catch {
			return false;
		}
	}

}

export class FileStat implements vscode.FileStat {

	constructor(private fsStat: fs.Stats) { }

	get type(): vscode.FileType {
		return this.fsStat.isFile() ? vscode.FileType.File : this.fsStat.isDirectory() ? vscode.FileType.Directory : this.fsStat.isSymbolicLink() ? vscode.FileType.SymbolicLink : vscode.FileType.Unknown;
	}

	get isFile(): boolean | undefined {
		return this.fsStat.isFile();
	}

	get isDirectory(): boolean | undefined {
		return this.fsStat.isDirectory();
	}

	get isSymbolicLink(): boolean | undefined {
		return this.fsStat.isSymbolicLink();
	}

	get size(): number {
		return this.fsStat.size;
	}

	get ctime(): number {
		return this.fsStat.ctime.getTime();
	}

	get mtime(): number {
		return this.fsStat.mtime.getTime();
	}
}

export interface Entry {
	uri: vscode.Uri;
	fileName: String;
	fileType: vscode.FileType;
	explorerFileType: ExplorerFileType;
}

enum ExplorerFileType {
	Dmn = 1,
	Test
  }

//#endregion

export class DecisionTreeProvider implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider {

	private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	private _onDidChangeTreeData: vscode.EventEmitter<Entry | undefined> = new vscode.EventEmitter<Entry | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Entry | undefined> = this._onDidChangeTreeData.event;

	constructor() {
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		const watcher = fs.watch(uri.fsPath, { recursive: options.recursive }, async (event: string, filename: string | Buffer) => {
			const filepath = path.join(uri.fsPath, _.normalizeNFC(filename.toString()));

			// TODO support excludes (using minimatch library?)

			this._onDidChangeFile.fire([{
				type: event === 'change' ? vscode.FileChangeType.Changed : await _.exists(filepath) ? vscode.FileChangeType.Created : vscode.FileChangeType.Deleted,
				uri: uri.with({ path: filepath })
			} as vscode.FileChangeEvent]);
		});

		return { dispose: () => watcher.close() };
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		return this._stat(uri.fsPath);
	}

	async _stat(path: string): Promise<vscode.FileStat> {
		return new FileStat(await _.stat(path));
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		return this._readDirectory(uri);
	}

	//called by the getChildren function, when root is null. 
	async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		console.log("in the _readDirectory method");
		if (! fs.existsSync(uri.fsPath)) {
			console.log("does not exist");
		}
		const children = await _.readdir(uri.fsPath);
		console.log("past await in _readDirectory");
		const result: [string, vscode.FileType][] = [];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const stat = await this._stat(path.join(uri.fsPath, child));
			result.push([child, stat.type]);
		}

		return Promise.resolve(result);
	}

	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
		return _.readfile(uri.fsPath);
	}

	//#region 
	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	copy?(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}

	getParent?(element: Entry): vscode.ProviderResult<Entry> {
		throw new Error('Method not implemented.');
	}
	// resolveTreeItem?(item: vscode.TreeItem, element: Entry, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
	// 	throw new Error('Method not implemented.');
	// }

	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}
	//#endregion

	async getChildren(element?: Entry): Promise<Entry[]> {
		console.log("getChildren called with element = ", element);
		if (vscode.workspace.workspaceFolders == null)
			return [];

		// for the initial call (root) this will be null, and thus will be false, and and skipped over.
		if (element) {
			console.log("getting kids of " + element.uri.toString());
			var folderuri = vscode.Uri.parse(element.uri.toString().substring(0,element.uri.toString().lastIndexOf(".")) + "-tests");
			console.log(folderuri.toString());
			try
			{
				console.log("in try");
				const children = await this.readDirectory(folderuri);
				console.log("past awaiting");
				console.log("getting offspring:" + children.toString());
				console.log("folder:" + folderuri.toString());
				console.log("as file:" + vscode.Uri.file(folderuri.toString()));
				console.log("as fs:" + folderuri.fsPath);
			
				return children.map(([name, type]) => ({ uri: Utils.joinPath(folderuri, name),fileName: name, fileType:type, explorerFileType: ExplorerFileType.Test }));
				}
			catch(e)
			{
				console.log("Error attempting to open test folder: " + e.message);
				return [];
			}
		} else {

			const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
			console.log(workspaceFolder)
			if (workspaceFolder) {
				const directoryItems = await this.readDirectory(workspaceFolder.uri);
				const children = directoryItems.filter(e => e[0].endsWith(".dmn"))

				
				children.sort((a, b) => {
					if (a[1] === b[1]) {
						return a[0].localeCompare(b[0]);
					} else {
						return a[1] === vscode.FileType.Directory ? -1 : 1;
					}
				});
				console.log("leaving getChildren. count children:", children.length)
				return children.map(([name, type]) => ({ uri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name)), fileName: name, fileType:type, explorerFileType: ExplorerFileType.Dmn }));
			}

			//return [];
		}
	}

		//a registered command
	refreshFile(element: Entry) {
			this._onDidChangeTreeData.fire(element);// _onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri: element}]);
			//Write to output.
		}

	async getTreeItem(element: Entry): Promise<vscode.TreeItem> {
		const treeItem = new vscode.TreeItem(element.uri, element.fileType === vscode.FileType.Directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		//var size: number = 0;
		if (element.fileType === vscode.FileType.File && element.explorerFileType === ExplorerFileType.Dmn) {
			treeItem.command = { command: 'decisionExplorer.validateDmn', title: "Validate DMN", arguments: [element.uri], };
			treeItem.contextValue = 'file';
/* 			try {
				size = (await this.stat(element.uri)).size;
			} catch (error) {

			}
			console.log("get tree item" + element.uri.fsPath.toString());
			treeItem.description = "rhett was here"; */
			//treeItem.contextValue = 'folder';
			treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			//treeItem.description = ` -  ${filesize(size)} - (${filesize(this._getGzipSize(element.uri.fsPath))})`;

		} else if (element.explorerFileType === ExplorerFileType.Test) {
			treeItem.command = { command: 'decisionExplorer.blank', title: "do nothing", arguments: [element.uri], };
		}
		else if (element.fileType == vscode.FileType.Directory) {
			// no need for folders...yet.
			//size = 1;// (await this._getDirSize(element.uri.fsPath)) as number;
			//treeItem.description =  "rhe1:";//` - ${filesize(size)}`;
		}
		//treeItem.tooltip = "I dont know about this";
		return treeItem;
	}
}
