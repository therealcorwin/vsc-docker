
import * as vscode from 'vscode';
var opn = require('opn');
import { StringDecoder } from 'string_decoder';
import { Readable } from "stream";

import { Docker } from './docker';
import { HtmlView } from './html-lite';

import { FileBrowserDocker } from './file-browser-docker';
import { FileBrowserLocal } from './file-browser-local';

var docker: Docker = new Docker(vscode.workspace.rootPath, cmdHandler, logHandler, closeHandler);
var html: HtmlView = HtmlView.getInstance();

var fs = require('fs');
var path = require('path');


var g_Config = {};
var g_availableImages = {};
var g_StatusBarItems = {};
var g_StoragePath = '';

var g_Terminals = {};

var g_FileBrowserDocker: FileBrowserDocker = null;
var g_FileBrowserLocal: FileBrowserLocal = null;
var copyPaste = require('copy-paste');

var out: vscode.OutputChannel = vscode.window.createOutputChannel("\u27a4 Docker Runner");

/**
 * Activate extension
 * 
 * @param context 
 */
export function activate(context: vscode.ExtensionContext) {

    g_StoragePath = context.storagePath;
    html.setExtensionPath(context.extensionPath);

    loadConfig();

    console.log('Congratulations, your extension "vsc-docker" is now active!');

    registerCommand(context, 'extension.openMainMenu', () => {
        displayMainMenu();
    });

    registerCommand(context, 'extension.removeContainers', (...p:any[]) => {
        console.log("REMOVE CONTAINERS CALLED! " + JSON.stringify(p));

        docker.rm(p[0], true, function(result) {
            vscode.window.showInformationMessage('RESULT: ' + JSON.stringify(result));

            queryContainers();            
         })

    });

    registerCommand(context, 'extension.installImageOptions', (...p:any[]) => {
            installImageOptions(p[0], p[1]);
    });

    registerCommand(context, 'extension.containerOptions', (...p:any[]) => {
        displayContainerOptions(p[0], p[1]);
    });

    registerCommand(context, 'extension.containerDelete', (...p:any[]) => {
        deleteContainer(p[0], p[1]);
    });

    registerCommand(context, 'extension.imageOptions', (...p:any[]) => {
        displayImageOptions(p[0], p[1]);
    });

    registerCommand(context, 'extension.imageDelete', (...p:any[]) => {
        deleteImage(p[0], p[1]);
    });

    registerCommand(context, 'extension.fileOpen', (...p:any[]) => {
        g_FileBrowserDocker.open(p[0]);
    });

    registerCommand(context, 'extension.fileOptions', (...p:any[]) => {
        g_FileBrowserDocker.options(p[0]);
    });

    registerCommand(context, 'extension.fileDelete', (...p:any[]) => {
        g_FileBrowserDocker.delete(p[0]);
    });

    registerCommand(context, 'extension.localFileOpen', (...p:any[]) => {
        g_FileBrowserLocal.open(p[0]);
    });

    registerCommand(context, 'extension.localFileOptions', (...p:any[]) => {
        g_FileBrowserLocal.options(p[0]);
    });

    registerCommand(context, 'extension.localFileDelete', (...p:any[]) => {
        g_FileBrowserLocal.delete(p[0]);
    });


    registerCommand(context, 'extension.handler', (...p:any[]) => {
        cmdHandler(p[0], p[1]);
    });

    registerCommand(context, 'extension.htmlEvent', (...p:any[]) => {
        // parameters:
        //  1) document
        //  2) element id
        //  3) event type
        //  4) event param
        html.handleEvent(p[0], p[1], p[2], p[3]);
    });

    registerCommand(context, 'extension.showLocalImages', (...p:any[]) => {
        queryImages();
    });

    registerCommand(context, 'extension.showLocalContainers', (...p:any[]) => {
        queryContainers();
    });

    registerCommand(context, 'extension.searchImages', (...p:any[]) => {
        searchImages();
    });

    var item = vscode.window.createStatusBarItem();

    item.text = "\u27a4 Docker Runner";
    item.command = "extension.openMainMenu";
    item.show();

    // show output channel
    out.show();
}

/**
 * Deactivate extension
 */
export function deactivate() {
}

/**
 * Display main menu
 */
function displayMainMenu() {

    if (!docker.isInstalled()) {
        vscode.window.showErrorMessage('Docker seems to be not available!');
        return;
    }

    var items:string[] = [];

    items.push('Local Images');
    items.push('Local Containers');
    items.push('Search Images');
    items.push('Edit Configuration');
    items.push('Info');
    items.push('________________');

    for (var item in g_Config) {
        items.push((g_Terminals.hasOwnProperty(docker.nameFromId(item)) ? '\u26ab' : '\u26aa') + g_Config[item].description + ' [' +  item + ']')
    }

   vscode.window.showQuickPick(items).then( selected => {
        if (selected == 'Edit Configuration') {
            vscode.workspace.openTextDocument(g_StoragePath + '/config.json').then( (document) => {
                vscode.window.showTextDocument(document);
            });
        } else if (selected == 'Search Images') {
            searchImages();
        } else if (selected == 'Local Containers') {
            queryContainers();
        } else if (selected == 'Local Images') {
            queryImages();
        } else if (selected == 'Info') {
            displayInfo();
        } else {
            var image: string = selected.split('[')[1].split(']')[0];
            displayContainerMenu(image);
        }
    })
}

/**
 * Display container menu
 * 
 * @param image 
 */
function displayContainerMenu(image: string) {
    var cc :any = g_Config[image];

    if (typeof cc == 'object') {
        if (cc.config.compatible) {

            if (g_Terminals.hasOwnProperty(docker.nameFromId(image))) {
                cmdHandler([ 'docker:menu' ], image);
            } else {
                startContainerFromTerminal(image, true, function() {
                    cmdHandler([ 'docker:menu' ], image);
                });
            }
        } else {
            if (g_Terminals.hasOwnProperty(docker.nameFromId(image))) {
                cmdHandler([ 'ide:menu', cc.menu ], image);
            } else {
                startContainerFromTerminal(image, true, function() {
                    cmdHandler([ 'ide:menu' ], image);
                });
            }
        }
    }
}

enum ContainerState {
    Created,
    Running,
    Paused,
    Exited
}

/**
 * Display container options
 * 
 * @param id 
 * @param status 
 */
function displayContainerOptions(id: string, status: string) {
    var items:string[] = [];

    var state: ContainerState = ContainerState.Running;

    if (status.indexOf('Created') >= 0) {
        state = ContainerState.Created;
    } else if (status.indexOf('Exited') >= 0) {
        state = ContainerState.Exited;
    } else if (status.indexOf('Paused') >= 0) {
        state = ContainerState.Paused;
    }

    if ((state == ContainerState.Created) || (state == ContainerState.Exited)) {
        items.push('Start');
    }

    if (state != ContainerState.Paused) {
        if (state == ContainerState.Exited) {
            items.push('Remove');
        } else {
            items.push('Kill & Remove');
        }

        // XXX - container can be restarted only when not paused -- and what else?
        items.push('Restart');
    }

    if (state == ContainerState.Running) {
        items.push('Pause');
    } else if (state == ContainerState.Paused) {
        items.push('Unpause');
    }

    items.push('Rename');


    items.push('Diff');
    items.push('Top');
    items.push('Logs');
    items.push('Browse');

    vscode.window.showQuickPick(items).then( selected => {
        if (selected == 'Remove') {
            docker.rm([ id ], false, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container removed');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();            
            })
        } else if (selected == 'Kill & Remove') {
            docker.rm([ id ], true, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container removed');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();            
            })
        } else if (selected == 'Rename') {
            vscode.window.showInputBox({ prompt: 'New name'}).then( (newName) => {
                docker.rename(id, newName, function(result) {
                    if (result) {
                        vscode.window.showInformationMessage('Container renamed');
                    } else {
                        vscode.window.showErrorMessage('Operation failed');
                    }
                    queryContainers();            
                })
            })

        } else if (selected == 'Pause') {
            docker.pause(id, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container paused');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();                            
            })
        } else if (selected == 'Unpause') {
            docker.unpause(id, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container unpaused');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();                            
            })
        } else if (selected == 'Start') {
            docker.start(id, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container started');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();                            
            })
        } else if (selected == 'Restart') {
            docker.restart(id, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container restarted');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();                            
            })
        } else if (selected == 'Diff') {
            docker.diff(id, function (result: object) {
                html.createPreviewFromText('docker', result.toString(), "Diff");
            })

        } else if (selected == 'Top') {
            docker.top(id, function (result: object) {
                html.createPreviewFromText('docker', result.toString(), "Diff");
            })

        } else if (selected == 'Logs') {
            docker.logs(id, function (result: object) {
                html.createPreviewFromText('docker', result.toString(), "Logs");
            })

        } else if (selected == 'Browse') {
            g_FileBrowserDocker = new FileBrowserDocker(docker, id, '/');
            g_FileBrowserDocker.open('');

            var localPath: string = vscode.workspace.rootPath.split('\\').join('/');
            
            g_FileBrowserLocal = new FileBrowserLocal(localPath);
            g_FileBrowserLocal.open('');

            g_FileBrowserDocker.setOppositeBrowser(g_FileBrowserLocal);
            g_FileBrowserLocal.setOppositeBrowser(g_FileBrowserDocker);
        }
    })
}

/**
 * Delete container
 * 
 * @param id 
 * @param status 
 */
function deleteContainer(id: string, status: string) {
    vscode.window.showWarningMessage('Do you want to delete "' + id + '"?', 'Delete').then ( result => {
        if (result == 'Delete') {
            docker.rm([ id ], true, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Container removed');
                } else {
                    vscode.window.showErrorMessage('Operation failed');
                }
                queryContainers();            
            })
        }
    })
}

/**
 * Display image options
 * 
 * @param name 
 * @param repository 
 */
function displayImageOptions(name: string, repository: string) {
    var items:string[] = [];

    items.push('Pull');
    items.push('Push');
    items.push('Load');
    items.push('Save');
    items.push('History');
    items.push('Remove');

    vscode.window.showQuickPick(items).then( selected => {
        if (selected == 'History') {
            docker.history(name, function (result: object) {

                // add complex definition to the headers
                result['title'] = 'History of ' + name;

                // XXX - just for testing purposes here
                html.createPreviewFromObject('docker', 'History', result, 1, null);
            })
        } else if (selected == 'Remove') {
            docker.rmi([ name ], function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Image removed!');                    
                } else {
                    vscode.window.showErrorMessage('Removing image failed!');
                }

                queryImages();

                if (g_Config.hasOwnProperty(repository)) {
                    delete g_Config[repository];
                    saveConfig();
                }
            })
        } else if (selected == 'Pull') {
            docker.pull(repository, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Pull completed!');
                } else {
                    vscode.window.showErrorMessage('Pull failed');
                }

                queryImages();
            })
        } else if (selected == 'Push') {
            docker.push(repository, function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Push completed!');
                } else {
                    vscode.window.showErrorMessage('Push failed');
                }

                queryImages();
            })
        } else if (selected == 'Save') {
            vscode.window.showInformationMessage('Not implemented yet!');
        } else if (selected == 'Load') {
            vscode.window.showInformationMessage('Not implemented yet!');
        }
    })
}

/**
 * Delete image
 * 
 * @param name 
 * @param repository 
 */
function deleteImage(name: string, repository: string) {
    vscode.window.showWarningMessage('Do you want to delete "' + name + '"?', 'Delete').then ( result => {
        if (result == 'Delete') {
            docker.rmi([ name ], function(result) {
                if (result) {
                    vscode.window.showInformationMessage('Image removed!');                    
                } else {
                    vscode.window.showErrorMessage('Removing image failed!');
                }

                queryImages();

                if (g_Config.hasOwnProperty(repository)) {
                    delete g_Config[repository];
                    saveConfig();
                }
            })
        }
    })
}

function registerCommand(context: vscode.ExtensionContext, name, func) {
    let disposable = vscode.commands.registerCommand(name, func);
    context.subscriptions.push(disposable);    
}

/**
 * Display general Docker information
 */
function displayInfo() {
    docker.info(function (result: object) {
        if (result) {
            html.createPreviewFromText('info', result.toString(), 'Info');
        } else {
            vscode.window.showErrorMessage('Operation failed!');                
        }
    })       
}

/**
 * Query local images
 */
function queryImages() {
    docker.images(function (result: object) {
        if (result) {
            // add complex definition to the headers
            result['title'] = 'Docker Images';

            result['onSelect'] = ['command:extension.imageOptions', '$image id', '$repository'];
            result['onDelete'] = ['command:extension.imageDelete', '$image id', '$repository'];

            result['actions'] = [ {name: 'Refresh', link: [ 'command:extension.showLocalImages' ] } ];

            html.createPreviewFromObject('images','Images', result, 1, null);
        } else {
            vscode.window.showErrorMessage('Operation failed!');                
        }
    })       
}

/**
 * Query local containers
 */
function queryContainers() {
    docker.ps(true, function (result: object) {

        if (result) {
            // add complex definition to the headers
            result['title'] = 'Containers';
            result['onSelect'] = ['command:extension.containerOptions', '$container id', '$status'];
            result['onDelete'] = ['command:extension.containerDelete', '$container id', '$status'];

            result['actions'] = [ {name: 'Refresh', link: ['command:extension.showLocalContainers' ] } ];

            html.createPreviewFromObject('containers', 'Containers', result, 1, '');
        } else {
            vscode.window.showErrorMessage('Operation failed!');                
        }
    })
}

/**
 * Search images in Docker Hub
 */
function searchImages() {
    vscode.window.showInputBox( { prompt: "Search string" } ).then( (filter) => {
        var items:string[] = [];

        docker.search(filter, function (result: object) {

            if (result) {
                // add complex definition to the headers
                result['title'] = 'Search Docker Hub';
                result['onSelect'] = ['command:extension.installImageOptions', '$name', '$description'];

                // XXX - just for testing purposes here
                html.createPreviewFromObject('docker', 'Search', result, 1, null);
            } else {
                vscode.window.showErrorMessage('Search failed!');                
            }
        })
    } )
}

function installImageOptions(id: string, description: string) {

    var items:string[] = [];

    items.push('Pull');
    items.push('Pull & Pin to the Menu');

    vscode.window.showQuickPick(items).then( selected => {
        if (selected == 'Pull') {
            installImage(id, description, false);
        } else if (selected == 'Pull & Pin to the Menu') {
            installImage(id, description, true);
        }
    });
}
 

function installImage(id: string, description: string, pin: boolean) {

    docker.pull(id, function(result) {
        if (result) {
            if (pin) {
                docker.getConfig(id, function(config) {
                    if (config) {
                        vscode.window.showInformationMessage("Installed Visual Studio Code compatible image!");
                        g_Config[id] = {};
                        g_Config[id].config = config;
                        g_Config[id].config.compatible = true;
                    } else {
                        vscode.window.showInformationMessage("Installed generic image!");

                        g_Config[id] = {};
                        g_Config[id].config = {};
                        g_Config[id].config.compatible = false;
                        g_Config[id].description = description;
                    }

                    g_Config[id].config.run = "-i -t --rm --name $default-name -v $workspace:$src " + id + " sh"

                    g_Config[id].menu = {
                        items: [ "Shell", "Execute" ],
                        commands: [ ["ide:bash"], ["ide:execute"]] 
                    };

                    saveConfig();
                });
            } else {
                vscode.window.showInformationMessage("Image pulled!");
            }            
        } else {
            vscode.window.showErrorMessage('Failed to pull image!');
        }
    })
}

function logHandler(data: string) {
    out.append(data);
}

function closeHandler(id: string) {
    // remove terminal
    if (g_Terminals.hasOwnProperty(id)) {
        g_Terminals[id].dispose();
        delete g_Terminals[id];
    }
}

function cmdHandler(json: any, container: string) {
    try {
        // XXX - stupid thing! made this to make sure this function won't damage original JSON
        // XXX - have to figure out how to do this properly in JS
        var params = (typeof json == 'string') ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
        var cmd = params[0];
        var cmdPrefix: string = cmd.split(':')[0];
        var cmdPostfix: string = cmd.split(':')[1];

        if (cmdPrefix == 'ide') {
            params.splice(0, 1);
            switch (cmdPostfix) {
                case 'info':
                    vscode.window.showInformationMessage(params[0]);
                    break;
                case 'error':
                    vscode.window.showErrorMessage(params[0]);
                    break;
                case 'input':
                    vscode.window.showInputBox({ prompt: params[0].label, value: params[0].default}).then( (text) => {
                        var command: any[] = params[0].command;
                        command.push(text);
                        cmdHandler(command, container) 
                    })
                    break;
                case 'menu':
                    vscode.window.showQuickPick(params[0].items).then( (selected) => {
                        if (selected)
                        {
                            var index: number = params[0].items.indexOf(selected);
                            cmdHandler(params[0].commands[index], container) 
                        }
                    })
                    break;
                case 'clipboard':
                    copyPaste.copy(params[0]);
                    break;
                case 'openurl':
                    opn(params[0]);    
                    break;
                case 'html':
                    html.preview('extension', params[0], 'Info', 1);
                    break;
                case 'form':
                    html.createPreviewFromObject("extension", "Extension", params[0], 1, container);
                    break;
                case 'status':
                    var name: string = params[0].name;
                    var command: string = params[0].command;

                    if (!g_StatusBarItems.hasOwnProperty('name')) {
                        g_StatusBarItems['name'] = vscode.window.createStatusBarItem();
                        g_StatusBarItems['name'].show();
                    }

                    if (params[0].hasOwnProperty('text')) {
                        g_StatusBarItems['name'].text = params[0].text;
                    }

                    if (params[0].hasOwnProperty('command')) {
                        g_StatusBarItems['name'].command = params[0].command;
                    }
                    break;
                case 'bash':
                    startContainerFromTerminal(container, true, function() {});
                    break;
                case 'execute':
                    if (params.length < 1) {
                        vscode.window.showInputBox( { prompt: "Enter command", value: ''} ).then( (cmd) => {
                            out.appendLine('\u27a4\u27a4 ' + container + " \u27a4\u27a4 " + cmd + " \u27a4\u27a4");
                            out.show();
                            docker.exec(container, cmd.split(' '), function(result) {
                                if (result) {
                                    vscode.window.showInformationMessage('Execution Successful!', 'Store').then( (result) => {
                                        if (result == 'Store') {
                                            vscode.window.showInputBox( { prompt: "Menu item name", value: ''} ).then( (name) => {
                                                g_Config[container].menu.items.push(name);
                                                g_Config[container].menu.commands.push(['ide:execute'].concat(cmd.split(' ')));

                                                saveConfig();
                                            });
                                        }
                                    });
                                } else {
                                    vscode.window.showErrorMessage('Execution Failed!');
                                }
                                out.appendLine('\u2b24');
                            });
                        });
                    } else {
                        out.appendLine('\u27a4\u27a4 ' + container + " \u27a4\u27a4 " + params.join(' ') + " \u27a4\u27a4");
                        out.show();
                        docker.exec(container, params, function (result) {
                            if (result) {
                                vscode.window.showInformationMessage('Execution Successful!');
                            } else {
                                vscode.window.showErrorMessage('Execution Failed!');
                            }
                            out.appendLine('\u2b24');
                        });
                    }
                    break;
                case 'install':
                    // install required container and launch welcome screen
                    docker.pull(params[0], function(result) {
                        if (result) {
                            startContainerFromTerminal(params[0], true, function (result) {
                                // image is now started

                                // send command to the container
                                docker.execCmd(params[0], ['docker:welcome'], function(result) {});
                            });

                        } else {

                        }
                    })
                    break;
                case 'log':
                    out.appendLine(params[0]);
                    out.show();
                    break;
            }
        } else if (cmdPrefix == 'docker') {
            docker.execCmd(container, params, function(result) {});
        }

        vscode.commands.executeCommand(cmd, params);
    } catch (e) {
        console.log("Parsing JSON failed:");
        console.log(json);
    }
}

function startContainerFromTerminal(id: string, view: boolean, cb) {
    var name = docker.nameFromId(id);

    if (g_Terminals.hasOwnProperty(name)) {
        // just show the terminal if it was already created for this container
        if (view) g_Terminals[name].show();
    } else {

        var cc :any = g_Config[id];
        var params: string = cc.config.run;

        // create a new terminal and show it
        g_Terminals[name]  = vscode.window.createTerminal(name);
        if (view) g_Terminals[name].show();

        // check if we already have this process isRunning

        docker.ps(false, function(result) {
            var exists: boolean = false;

            if (result) {
                for (var i = 0; i < result.rows.length; i++) {
                    if (result.rows[i].names == name) {
                        exists = true;
                    }
                }
            }

            if (exists) {
                g_Terminals[name].sendText('docker attach ' + name, true);
                docker.attach(id, g_Config[id].config.compatible, function(result) {
                    cb();
                });
            } else {
                var src = '/src';

                if (g_Config[id].config.src) {
                    src = g_Config[id].config.src;
                }

                params = params.replace('$default-name', name);
                params = params.replace('$workspace', vscode.workspace.rootPath);
                params = params.replace('$src', src);


                g_Terminals[name].sendText('docker run ' + params, true);

                setTimeout(function() {
                    docker.attach(id, g_Config[id].config.compatible, function(result) {
                        cb();
                    });
                }, 3000)
            }
        });
    }

}



fs.mkdirParent = function(dirPath, mode, callback) {
  //Call the standard fs.mkdir
  fs.mkdir(dirPath, mode, function(error) {
    //When it fail in this way, do the custom steps
    if (error && error.errno === 34) {
      //Create all the parents recursively
      fs.mkdirParent(path.dirname(dirPath), mode, callback);
      //And then the directory
      fs.mkdirParent(dirPath, mode, callback);
    }
    //Manually run the callback since we used our own callback to do all these
    callback && callback(error);
  });
};

/**
 * Load config.json file
 */
function loadConfig() {
    try {
        g_Config = JSON.parse(fs.readFileSync(g_StoragePath + '/config.json'));
    } catch (e) {
        console.log('--- FAILED ---');
        g_Config = {};
    }
}

/**
 * Save config.json file
 */
function saveConfig() {
    fs.mkdirParent(g_StoragePath, undefined, function () {
        fs.writeFileSync(g_StoragePath + '/config.json', JSON.stringify(g_Config, null, 2));
    })
}
