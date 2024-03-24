import * as vscode from 'vscode';
import  {Headers}  from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs';
import * as readFile from 'fs';
import { promisify, TextEncoder } from 'util';
//import * as fastFolderSize from 'fast-folder-size'
//import * as filesize from 'filesize'
//import gzipSize = require('gzip-size');
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

interface Entry {
	uri: vscode.Uri;
	fileName: String;
	type: vscode.FileType;
}

//#endregion

export class FileSystemProvider implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider {

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
			
				return children.map(([name, type]) => ({ uri: Utils.joinPath(folderuri, name),fileName: name, type }));
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
				return children.map(([name, type]) => ({ uri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name)), fileName: name, type }));
			}

			//return [];
		}
	}

		//a registered command
	refreshFile(element: Entry) {
			this._onDidChangeTreeData.fire(element);// _onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri: element}]);
			//Write to output.
		}

	//a registered command
	async validateDMN(element: Entry) {
		//this._onDidChangeTreeData.fire(element);// _onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri: element}]);
		let orange = vscode.window.createOutputChannel(element.uri.toString() + " Test");
		//Write to output.
		 
		let dmnStr: string = '<dmn:definitions xmlns:dmn="http://www.omg.org/spec/DMN/20180521/MODEL/" xmlns="https://kiegroup.org/dmn/_79B69A7F-5A25-4B53-BD6A-3216EDC246ED" xmlns:feel="http://www.omg.org/spec/DMN/20180521/FEEL/" xmlns:kie="http://www.drools.org/kie/dmn/1.2" xmlns:dmndi="http://www.omg.org/spec/DMN/20180521/DMNDI/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" id="_E01B9C96-BCD5-4618-AC02-35F77D1065E2" name="loan" typeLanguage="http://www.omg.org/spec/DMN/20180521/FEEL/" namespace="https://kiegroup.org/dmn/_79B69A7F-5A25-4B53-BD6A-3216EDC246ED"> <dmn:extensionElements/> <dmn:itemDefinition id="_94619DCD-2602-4A43-97E9-9809D76F15A5" name="tLoan" isCollection="false"> <dmn:itemComponent id="_3C8953D0-F1AD-40F6-BC5E-813F3185F3F1" name="amount" isCollection="false"> <dmn:typeRef>number</dmn:typeRef> </dmn:itemComponent> <dmn:itemComponent id="_1CF9A4C0-9218-4F96-AB1A-66570002B7C5" name="years" isCollection="false"> <dmn:typeRef>number</dmn:typeRef> </dmn:itemComponent> </dmn:itemDefinition> <dmn:inputData id="_058269A1-A5AC-44CB-9479-16A04DC19D77" name="Credit score"> <dmn:extensionElements/> <dmn:variable id="_BA408840-4504-44EB-BD7F-6261F787E342" name="Credit score" typeRef="number"/> </dmn:inputData> <dmn:inputData id="_65226EA1-EE4A-41F1-91A2-B2A940A75982" name="Salary"> <dmn:extensionElements/> <dmn:variable id="_204FE05E-BCF8-4AF5-AD36-B5A04E0EB929" name="Salary" typeRef="number"/> </dmn:inputData> <dmn:inputData id="_516E0AEC-03F3-43F4-B886-C489CA82A1C9" name="Loan"> <dmn:extensionElements/> <dmn:variable id="_90456001-E9FA-4DDC-B2BA-DF1B62A25AAA" name="Loan" typeRef="tLoan"/> </dmn:inputData> <dmn:decision id="_6A3FDF72-7F17-4DC5-AC1D-1DCC972C0146" name="Preapproval"> <dmn:extensionElements/> <dmn:variable id="_2C06D150-7AB2-48C9-BFC6-F48884FD96EF" name="Preapproval" typeRef="boolean"/> <dmn:informationRequirement id="_9BFEFD1E-9830-4630-8171-B6F1D3100308"> <dmn:requiredInput href="#_058269A1-A5AC-44CB-9479-16A04DC19D77"/> </dmn:informationRequirement> <dmn:informationRequirement id="_4736D6D5-5A61-4C0E-ADBA-5AAD99221445"> <dmn:requiredDecision href="#_50635164-1A27-4B84-AE16-639A118CE44C"/> </dmn:informationRequirement> <dmn:decisionTable id="_E7994A2B-1189-4BE5-9382-891D48E87D47" hitPolicy="UNIQUE" preferredOrientation="Rule-as-Row"> <dmn:input id="_9CCC5EBB-BC59-4397-B478-BB434279EBF8"> <dmn:inputExpression id="_85A80C30-68FA-405F-BE6D-D1B6C484CD81" typeRef="number"> <dmn:text>Credit score</dmn:text> </dmn:inputExpression> </dmn:input> <dmn:input id="_D160037A-3B50-44FE-BC28-700F750D1A3A"> <dmn:inputExpression id="_2774CDB9-0B9D-4B89-9639-5D1FD7D6D61B" typeRef="number"> <dmn:text>DTI</dmn:text> </dmn:inputExpression> </dmn:input> <dmn:output id="_8220E87A-3913-4FC5-9926-4A9FD28F82EA"/> <dmn:annotation name="annotation-1"/> <dmn:rule id="_C09BF27F-E03C-4390-8719-E7411784ABCB"> <dmn:inputEntry id="_C02D6987-5B78-42ED-B48D-E3CE5844C22B"> <dmn:text>&lt;700</dmn:text> </dmn:inputEntry> <dmn:inputEntry id="_922FFAE0-9635-420B-8002-4583065E6710"> <dmn:text>&lt;=.28</dmn:text> </dmn:inputEntry> <dmn:outputEntry id="_75A30858-95A6-46F4-89D5-BFFF8B3739AD"> <dmn:text>true</dmn:text> </dmn:outputEntry> <dmn:annotationEntry> <dmn:text/> </dmn:annotationEntry> </dmn:rule> <dmn:rule id="_5CE22529-735A-43D8-9043-E342F58D1CDD"> <dmn:inputEntry id="_14C78BCF-736B-4032-8AB8-B73967479EEF"> <dmn:text>&gt;=700</dmn:text> </dmn:inputEntry> <dmn:inputEntry id="_6AA1D822-C08E-4B4E-BE8B-4C3587E6F034"> <dmn:text>-</dmn:text> </dmn:inputEntry> <dmn:outputEntry id="_CD1AFB69-DDC6-416E-B780-FE2FB3AAC6C1"> <dmn:text>true</dmn:text> </dmn:outputEntry> <dmn:annotationEntry> <dmn:text/> </dmn:annotationEntry> </dmn:rule> <dmn:rule id="_5EB4DDC3-CE49-419A-B7C8-7A6916D6334F"> <dmn:inputEntry id="_2F5D6384-4AE6-4408-88F4-4D3C86F26649"> <dmn:text>&lt;700</dmn:text> </dmn:inputEntry> <dmn:inputEntry id="_5CA8DA56-07BE-4410-85DD-800508300DB8"> <dmn:text>&gt;.28</dmn:text> </dmn:inputEntry> <dmn:outputEntry id="_8B85A627-73DD-46E7-99DA-26499B3DD9BD"> <dmn:text>false</dmn:text> </dmn:outputEntry> <dmn:annotationEntry> <dmn:text/> </dmn:annotationEntry> </dmn:rule> </dmn:decisionTable> </dmn:decision> <dmn:decision id="_50635164-1A27-4B84-AE16-639A118CE44C" name="DTI"> <dmn:extensionElements/> <dmn:variable id="_7FF18790-80C8-4124-9BFB-93383CE6A50F" name="DTI" typeRef="number"/> <dmn:informationRequirement id="_7A538A2F-562E-4E49-B5F0-572FFCFEF4CB"> <dmn:requiredInput href="#_516E0AEC-03F3-43F4-B886-C489CA82A1C9"/> </dmn:informationRequirement> <dmn:informationRequirement id="_E508941C-2DE2-41DD-8406-EA8AD646DB7F"> <dmn:requiredInput href="#_65226EA1-EE4A-41F1-91A2-B2A940A75982"/> </dmn:informationRequirement> <dmn:literalExpression id="_60A349DD-1F30-488B-BA65-74160F6496F3"> <dmn:text>(Loan.amount / Loan.years)/Salary</dmn:text> </dmn:literalExpression> </dmn:decision> </dmn:definitions>';
 
	   
		 try {
			const https = require('http');
	
			 const data =   dmnStr;
	
			const options = {
				hostname : '0.0.0.0',
				port: 8080,
				path: '/jitdmn/validate',
				method: 'POST',
				headers: {
					'Content-Type': 'application/xml'
					}
			};
	
			const req = https.request(options, res => {
				//console.log('statusCode: ${res.statusCode}');
				
			  
				res.on('data', d => {
				  process.stdout.write(d)
				  orange.appendLine('bodyResponse: ' + d);
				});
			  });
			  
			  req.on('error', error => {
				orange.appendLine(error)
			  });
			  req.write(data);
			  req.end();
	
	
			
			}
			catch(e){
				console.log(e.toString());
			}
	}

		//a registered command
	
	async	testContext(element: Entry) {
		//Create output channel
		console.log("test Context..." + element.uri.toString());
		let orange = vscode.window.createOutputChannel(element.uri.toString() + " DMN-Val");
		// let m: string = "null";
		//Write to output.
		//orange.appendLine("this is where we will dispaly the reuslts. ");
		//orange.appendLine("about to send:" + element.uri.fsPath.toString());
		//orange.appendLine(element.uri.fsPath.toString());
		const fs = require('fs');
		
		const fileName =  element.uri.fsPath; // 'c:' + element.uri.toString().substring(22);
		console.log("fn::" + fileName);
		const fileData = fs.readFileSync(fileName, "utf8");
		console.log(fileData);
		fileName.lastIndexOf("-tests\\");
		
		//const arr = data.toString().replace(/\r\n/g,'\n').split('\n');
		 

		 let contextStr: string = '{"context": {"n" : 1, "m" : 2}, "model": "';
		 let dmnStr: string = '<dmn:definitions xmlns:dmn=\"http://www.omg.org/spec/DMN/20180521/MODEL/\" xmlns=\"https://kiegroup.org/dmn/_35091C3B-6022-4D40-8982-D528940CD5F9\" xmlns:feel=\"http://www.omg.org/spec/DMN/20180521/FEEL/\" xmlns:kie=\"http://www.drools.org/kie/dmn/1.2\" xmlns:dmndi=\"http://www.omg.org/spec/DMN/20180521/DMNDI/\" xmlns:di=\"http://www.omg.org/spec/DMN/20180521/DI/\" xmlns:dc=\"http://www.omg.org/spec/DMN/20180521/DC/\" id=\"_81A31B42-A686-4ED2-81FB-C1F91A95D685\" name=\"new-file\" typeLanguage=\"http://www.omg.org/spec/DMN/20180521/FEEL/\" namespace=\"https://kiegroup.org/dmn/_35091C3B-6022-4D40-8982-D528940CD5F9\"> <dmn:extensionElements/> <dmn:inputData id=\"_6FFA48B5-FB55-4962-9E64-F08418BBFF9E\" name=\"n\"> <dmn:extensionElements/> <dmn:variable id=\"_EC4D123A-D6D4-4E5D-B369-6E99F57D9C22\" name=\"n\" typeRef=\"number\"/> </dmn:inputData> <dmn:decision id=\"_1D69C44E-D782-492A-A50D-740B444F1993\" name=\"sum\"> <dmn:extensionElements/> <dmn:variable id=\"_3AF7A705-8304-4B5E-8EC7-05D9934E6C06\" name=\"sum\" typeRef=\"number\"/> <dmn:informationRequirement id=\"_E0FE5C90-5EAF-45DB-ABFD-10D27FA97AB4\"> <dmn:requiredInput href=\"#_6FFA48B5-FB55-4962-9E64-F08418BBFF9E\"/> </dmn:informationRequirement> <dmn:informationRequirement id=\"_C52CB29E-3236-4661-8856-7276AE8ED01F\"> <dmn:requiredInput href=\"#_B8221A07-DFB5-40BC-95A9-7926A6EC55C4\"/> </dmn:informationRequirement> <dmn:literalExpression id=\"_3DB33034-AC21-45DE-A5B7-D6B09B01ED1E\"> <dmn:text>n + m</dmn:text> </dmn:literalExpression> </dmn:decision> <dmn:inputData id=\"_B8221A07-DFB5-40BC-95A9-7926A6EC55C4\" name=\"m\"> <dmn:extensionElements/> <dmn:variable id=\"_455CD571-BBD9-4762-B496-832E7EBCD07F\" name=\"m\" typeRef=\"number\"/></dmn:inputData>';		
		dmnStr = dmnStr.replace(/\"/g,'\\\"');	
		  
		 //orange.appendLine(m);
		//console.log(contextStr + dmnStr + '</dmn:definitions>"}');
		//console.log("and done3333333333333333333");
		//let headr = new Headers();
		//let httpc: httpm.HttpClient = new httpm.HttpClient('vsts-node-api');
		//headr.set('Content-Type', 'application/json');
		//headr.set('Accept', 'application/json');
		try {
		const https = require('http');

		 const data = contextStr + dmnStr  + '</dmn:definitions>"}';

		const options = {
			hostname : '127.0.0.1',
			port: 8080,
			path: '/jitdmn',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
				}
		};

		const req = https.request(options, res => {
			//console.log('statusCode: ${res.statusCode}');
			
			res.on('data', d => {
			  process.stdout.write(d)
			  orange.appendLine('bodyResponse-127: ' + d);
			});
		  });
		  
		  req.on('error', error => {
			orange.appendLine(error)
		  });
		  req.write(data);
		  req.end();

		}
		catch(e){
			console.log(e.toString());
		}
		
	}

	//a registered command
	openFolder(element: Entry) {
		//vscode.commands.executeCommand("revealFileInOS", element.uri);
		console.log("just clicked open folder for" + element.uri.toString());
	}

	async getTreeItem(element: Entry): Promise<vscode.TreeItem> {
		console.log("getting element of type Entry:", element)
		const treeItem = new vscode.TreeItem(element.uri, element.type === vscode.FileType.Directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

		var size: number = 0;
		if (element.type === vscode.FileType.File /*&& element.uri.fsPath.endsWith(".dmn")*/) {
			treeItem.command = { command: 'fileExplorer.openFile', title: "Open File", arguments: [element.uri], };
			treeItem.contextValue = 'file';
			try {
				size = (await this.stat(element.uri)).size;
			} catch (error) {

			}
			console.log("get tree item" + element.uri.fsPath.toString());
			//treeItem.description = "rhett was here";
			//treeItem.contextValue = 'folder';
			treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			//treeItem.description = ` -  ${filesize(size)} - (${filesize(this._getGzipSize(element.uri.fsPath))})`;

		} else if (element.type == vscode.FileType.Directory) {

			size = 1;// (await this._getDirSize(element.uri.fsPath)) as number;
			treeItem.description =  "rhe1:";//` - ${filesize(size)}`;
		}
		//treeItem.tooltip = element.uri.fsPath;
		return treeItem;
	}

	


}

export class FileExplorer {
	constructor(context: vscode.ExtensionContext) {
		const treeDataProvider = new FileSystemProvider();
		context.subscriptions.push(vscode.window.createTreeView('fileExplorer', { treeDataProvider }));
		vscode.commands.registerCommand('fileExplorer.openFile', (resource) => this.openResource(resource));
		vscode.commands.registerCommand('fileExplorer.testContext', (resource) => treeDataProvider.testContext(resource));
		vscode.commands.registerCommand('fileExplorer.refreshRoot', (resource) => treeDataProvider.refreshFile(undefined));
		vscode.commands.registerCommand('fileExplorer.openFolder', (resource) => treeDataProvider.openFolder(resource));
		//vscode.commands.registerCommand('fileExplorer.validateDMN', (resource) => treeDataProvider.validateDMN(resource));

	}

	private openResource(resource: vscode.Uri): void {
		//vscode.commands.executeCommand("vscode.open", resource);
		//this._onDidChangeTreeData.fire(element);// _onDidChangeFile.fire([{type: vscode.FileChangeType.Changed, uri: element}]);
		let orange = vscode.window.createOutputChannel("DMN Tester 1");
		console.log("this is it: " + resource.toString());

		const fs = require('fs');
		const fileName = path.resolve(resource.fsPath.toString());
		const fileData = fs.readFileSync(fileName, "utf8");
		console.log(fileData);

		//let dmnStr: string = '<dmn:definitions xmlns:dmn="http://www.omg.org/spec/DMN/20180521/MODEL/" xmlns="https://kiegroup.org/dmn/_79B69A7F-5A25-4B53-BD6A-3216EDC246ED" xmlns:feel="http://www.omg.org/spec/DMN/20180521/FEEL/" xmlns:kie="http://www.drools.org/kie/dmn/1.2" xmlns:dmndi="http://www.omg.org/spec/DMN/20180521/DMNDI/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" id="_E01B9C96-BCD5-4618-AC02-35F77D1065E2" name="loan" typeLanguage="http://www.omg.org/spec/DMN/20180521/FEEL/" namespace="https://kiegroup.org/dmn/_79B69A7F-5A25-4B53-BD6A-3216EDC246ED"> <dmn:extensionElements/> <dmn:itemDefinition id="_94619DCD-2602-4A43-97E9-9809D76F15A5" name="tLoan" isCollection="false"> <dmn:itemComponent id="_3C8953D0-F1AD-40F6-BC5E-813F3185F3F1" name="amount" isCollection="false"> <dmn:typeRef>number</dmn:typeRef> </dmn:itemComponent> <dmn:itemComponent id="_1CF9A4C0-9218-4F96-AB1A-66570002B7C5" name="years" isCollection="false"> <dmn:typeRef>number</dmn:typeRef> </dmn:itemComponent> </dmn:itemDefinition> <dmn:inputData id="_058269A1-A5AC-44CB-9479-16A04DC19D77" name="Credit score"> <dmn:extensionElements/> <dmn:variable id="_BA408840-4504-44EB-BD7F-6261F787E342" name="Credit score" typeRef="number"/> </dmn:inputData> <dmn:inputData id="_65226EA1-EE4A-41F1-91A2-B2A940A75982" name="Salary"> <dmn:extensionElements/> <dmn:variable id="_204FE05E-BCF8-4AF5-AD36-B5A04E0EB929" name="Salary" typeRef="number"/> </dmn:inputData> <dmn:inputData id="_516E0AEC-03F3-43F4-B886-C489CA82A1C9" name="Loan"> <dmn:extensionElements/> <dmn:variable id="_90456001-E9FA-4DDC-B2BA-DF1B62A25AAA" name="Loan" typeRef="tLoan"/> </dmn:inputData> <dmn:decision id="_6A3FDF72-7F17-4DC5-AC1D-1DCC972C0146" name="Preapproval"> <dmn:extensionElements/> <dmn:variable id="_2C06D150-7AB2-48C9-BFC6-F48884FD96EF" name="Preapproval" typeRef="boolean"/> <dmn:informationRequirement id="_9BFEFD1E-9830-4630-8171-B6F1D3100308"> <dmn:requiredInput href="#_058269A1-A5AC-44CB-9479-16A04DC19D77"/> </dmn:informationRequirement> <dmn:informationRequirement id="_4736D6D5-5A61-4C0E-ADBA-5AAD99221445"> <dmn:requiredDecision href="#_50635164-1A27-4B84-AE16-639A118CE44C"/> </dmn:informationRequirement> <dmn:decisionTable id="_E7994A2B-1189-4BE5-9382-891D48E87D47" hitPolicy="UNIQUE" preferredOrientation="Rule-as-Row"> <dmn:input id="_9CCC5EBB-BC59-4397-B478-BB434279EBF8"> <dmn:inputExpression id="_85A80C30-68FA-405F-BE6D-D1B6C484CD81" typeRef="number"> <dmn:text>Credit score</dmn:text> </dmn:inputExpression> </dmn:input> <dmn:input id="_D160037A-3B50-44FE-BC28-700F750D1A3A"> <dmn:inputExpression id="_2774CDB9-0B9D-4B89-9639-5D1FD7D6D61B" typeRef="number"> <dmn:text>DTI</dmn:text> </dmn:inputExpression> </dmn:input> <dmn:output id="_8220E87A-3913-4FC5-9926-4A9FD28F82EA"/> <dmn:annotation name="annotation-1"/> <dmn:rule id="_C09BF27F-E03C-4390-8719-E7411784ABCB"> <dmn:inputEntry id="_C02D6987-5B78-42ED-B48D-E3CE5844C22B"> <dmn:text>&lt;700</dmn:text> </dmn:inputEntry> <dmn:inputEntry id="_922FFAE0-9635-420B-8002-4583065E6710"> <dmn:text>&lt;=.28</dmn:text> </dmn:inputEntry> <dmn:outputEntry id="_75A30858-95A6-46F4-89D5-BFFF8B3739AD"> <dmn:text>true</dmn:text> </dmn:outputEntry> <dmn:annotationEntry> <dmn:text/> </dmn:annotationEntry> </dmn:rule> <dmn:rule id="_5CE22529-735A-43D8-9043-E342F58D1CDD"> <dmn:inputEntry id="_14C78BCF-736B-4032-8AB8-B73967479EEF"> <dmn:text>&gt;=700</dmn:text> </dmn:inputEntry> <dmn:inputEntry id="_6AA1D822-C08E-4B4E-BE8B-4C3587E6F034"> <dmn:text>-</dmn:text> </dmn:inputEntry> <dmn:outputEntry id="_CD1AFB69-DDC6-416E-B780-FE2FB3AAC6C1"> <dmn:text>true</dmn:text> </dmn:outputEntry> <dmn:annotationEntry> <dmn:text/> </dmn:annotationEntry> </dmn:rule> <dmn:rule id="_5EB4DDC3-CE49-419A-B7C8-7A6916D6334F"> <dmn:inputEntry id="_2F5D6384-4AE6-4408-88F4-4D3C86F26649"> <dmn:text>&lt;700</dmn:text> </dmn:inputEntry> <dmn:inputEntry id="_5CA8DA56-07BE-4410-85DD-800508300DB8"> <dmn:text>&gt;.28</dmn:text> </dmn:inputEntry> <dmn:outputEntry id="_8B85A627-73DD-46E7-99DA-26499B3DD9BD"> <dmn:text>false</dmn:text> </dmn:outputEntry> <dmn:annotationEntry> <dmn:text/> </dmn:annotationEntry> </dmn:rule> </dmn:decisionTable> </dmn:decision> <dmn:decision id="_50635164-1A27-4B84-AE16-639A118CE44C" name="DTI"> <dmn:extensionElements/> <dmn:variable id="_7FF18790-80C8-4124-9BFB-93383CE6A50F" name="DTI" typeRef="number"/> <dmn:informationRequirement id="_7A538A2F-562E-4E49-B5F0-572FFCFEF4CB"> <dmn:requiredInput href="#_516E0AEC-03F3-43F4-B886-C489CA82A1C9"/> </dmn:informationRequirement> <dmn:informationRequirement id="_E508941C-2DE2-41DD-8406-EA8AD646DB7F"> <dmn:requiredInput href="#_65226EA1-EE4A-41F1-91A2-B2A940A75982"/> </dmn:informationRequirement> <dmn:literalExpression id="_60A349DD-1F30-488B-BA65-74160F6496F3"> <dmn:text>(Loan.amount / Loan.years)/Salary</dmn:text> </dmn:literalExpression> </dmn:decision> </dmn:definitions>';
		try {
		const https = require('http');
		const data =   fileData;
		const options = {
			hostname : '127.0.0.1',
			port: 8080,
			path: '/jitdmn/validate',
			method: 'POST',
			headers: {
				'Content-Type': 'application/xml'
				}
		};

		const req = https.request(options, res => {
			res.on('data', d => {
				process.stdout.write(d)
				orange.appendLine('bodyResponse-127: ' + d);
			});
				});
				
				req.on('error', error => {
				orange.appendLine(error)
				});
				req.write(data);
				req.end();
			
			}
			catch(e){
				console.log(e.toString());
			}
	}
}