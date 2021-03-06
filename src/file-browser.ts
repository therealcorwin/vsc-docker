
import { HtmlView } from './html-lite';
import * as vscode from 'vscode';

export abstract class FileBrowser
{
    constructor(path: string = '/', left: boolean)
    {
        this.m_CurrentDirectory = path;
        this.m_Left = left;
    }

    public setOppositeBrowser(browser: FileBrowser)
    {
        this.m_OppositeBrowser = browser;

        this.refreshHtml();
    }

    public open(name: string)
    {
        var isDirectory: boolean = false;

        if (name[0] == '[') {
            name = name.substr(1, name.length - 2);
            isDirectory = true;
        }

        if (name != '.') {
            var newPath: string = ('/' != this.m_CurrentDirectory) ? this.m_CurrentDirectory : '';
            
            if (name != '..') {
                newPath += '/' + name;
            } else {
                if (newPath == '') {
                    newPath = '/';
                } else {
                    var temp: string[] = newPath.split('/'); //
                    temp.pop();
                    newPath = (temp.length > 1) ? temp.join('/') : '/';
                }
            }

            this.m_CurrentDirectory = newPath;

            this.dir();
        }
    }

    public options(name: string)
    {
        var items:string[] = [];
        var isDirectory: boolean = false;


        if (name[0] == '[') {
            name = name.substr(1, name.length - 2);
            isDirectory = true;
        }

        items.push('Open');
        items.push('Copy');

        vscode.window.showQuickPick(items).then( selected => {
            if (selected == 'Copy') {
                this.copy(this.getFullPath() + '/' + name, this.m_OppositeBrowser.getFullPath());
                this.m_OppositeBrowser.refresh();
            } else if (selected == 'Open') {
                if (isDirectory) {
                    this.open(name);
                } else {
                    this.openFile(name);
                }
            }
        })     
    }

    abstract delete(name: string);

    abstract dir();
    abstract getViewerName(): string;
    abstract getViewerTitle(): string;
    abstract getPanel(): number;
    abstract copy(from: string, to: string);
    abstract getFullPath();
    abstract openFile(name: string);

    protected preview(dir: any)
    {
        for (var i: number = 0; i < dir.rows.length; i++) {
            if (dir.rows[i].isDirectory) {
                dir.rows[i].name = '[' + dir.rows[i].name + ']';
            } 
        }
        
        dir['title'] = this.m_CurrentDirectory;
        this.m_CurrentContent = dir;
        this.refreshHtml();

    }

    protected refreshHtml() {
        if (this.m_OppositeBrowser && this.m_CurrentContent && this.m_OppositeBrowser.m_CurrentContent) {
            var html: HtmlView = HtmlView.getInstance();
            var o: {} = { title: 'File Browser', panels: this.m_Left ? [this.m_CurrentContent, this.m_OppositeBrowser.m_CurrentContent] : [this.m_OppositeBrowser.m_CurrentContent, this.m_CurrentContent] };
            html.createPreviewFromObject('fs-browser', this.getViewerTitle(), o, 1, '');
        }
    }

    public getPath() : string
    {
        return this.m_CurrentDirectory;
    }

    public refresh()
    {
        this.dir();
    }

    protected m_CurrentDirectory: string = '';
    protected m_OppositeBrowser: FileBrowser;
    private m_CurrentContent: any;
    private m_Left: boolean = false;
}
