/* Pure DOM-safe chat and code formatter; never trusts user text as HTML. */
(() => {
 'use strict';
  function render(body,value) {
    body.replaceChildren();
    const blocks=String(value).split(/(```[a-zA-Z0-9+#.-]*\n[\s\S]*?```)/g);
    const lexer=/\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|async|await|export|import|return|type|interface|class|if|else|for|while|def|lambda|print|from|try|except|None|True|False|new|throw|public|private|fn|match|impl|struct)\b|\b\d+(?:\.\d+)?\b/g;
    for(const block of blocks){
      if(!block.startsWith('```') || !block.endsWith('```')) {
        body.append(document.createTextNode(block));continue;
      }
      const first=block.indexOf('\n'),language=block.slice(3,first).trim().slice(0,25);
      const text=block.slice(first+1,-3);
      const pre=document.createElement('pre');pre.className='kitsune-code';
      const header=document.createElement('span');header.className='kitsune-code-header';header.textContent=language||'Код';
      const code=document.createElement('code');let pos=0;
      for(const m of text.matchAll(lexer)){
        if(m.index>pos)code.append(document.createTextNode(text.slice(pos,m.index)));
        const piece=document.createElement('span'),t=m[0];
        piece.className=/^(?:\/\/|#)/.test(t)?'kitsune-token-comment':/^(?:"|')/.test(t)?'kitsune-token-string':/^\d/.test(t)?'kitsune-token-number':'kitsune-token-keyword';
        piece.textContent=t;code.append(piece);pos=m.index+t.length;
      }
      code.append(document.createTextNode(text.slice(pos)));pre.append(header,code);body.append(pre);
    }
  }

 window.MiyuneyaChatFormat=Object.freeze({render});
})();
