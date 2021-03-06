var nodes = chrome.storage.local;
var pmarks = chrome.storage.sync;
var longAgo = JSON.parse(localStorage["longAgo"] || 10);
var sendToSpider = JSON.parse(localStorage["sendToSpider"] || true);

// Clear chrome local storage each session
nodes.clear();
console.log("Cleared local storage");

// Set default referrer
nodes.set({REF: ""});

var createNode = function (url, referrer) {
  var edge = {
    in_node: referrer,
    timestamp: Date.now()
  };

  nodes.get(url, function(currentNode){
    currentNode[url] = currentNode[url] || [];
    currentNode[url].push(edge);
    nodes.set(currentNode, function(response){
      if ( chrome.runtime.lastError ) {
        console.log(chrome.runtime.lastError);
      }
      else {
        if (currentNode[url].length > 1) {
          console.log("Updated Node with url " + url + " and created new edge from " + 
            edge.in_node + " at time " + edge.timestamp);
        }
        else {
          console.log("Created new Node for url " + url + " and new edge from " + 
            edge.in_node + " at time " + edge.timestamp);
        }
      }
    });
  });
}

var handleReferrers = function(referrers, output, callback) {
  if (referrers.length > 0) {
    savePath(referrers[0].in_node, output, function(newOutput) {
      handleReferrers(referrers.slice(1), newOutput, callback);
    });
  } else {
    callback(output);
  }
};

var savePath = function(url, output, callback) {
  nodes.get(url, function(refObj) {
    // First predicate stops infinite loops and re-adding objects
    if (output[url] === undefined && refObj[url] !== undefined) {
      var referrers = refObj[url];
      output[url] = referrers;
      handleReferrers(referrers, output, function(finalOutput) {
        callback(finalOutput);
      });
    } else {
      callback(output);
    }
  });
};

saveRecents = function (minutes, callback) {
  chrome.storage.local.get(null, function (refObj) {
    var output = {};
    cutoffTime = Date.now() - (1000 * 60 * minutes);
    for (item in refObj) {
      refObj[item].forEach(function (edge) {
        if (edge.timestamp > cutoffTime) {
          output[item] = output[item] || [];
          output[item].push(edge);
        }});
    }
    callback(output);
  });
}

// Gets the current index from sync storage
var getInd = function () {
  dfd = jQuery.Deferred();
  chrome.storage.sync.get("index", function (indObj) {
    var index = indObj["index"] || 0;
    dfd.resolve(index);
  });
  return dfd.promise();
}

// Sets the current index
var setInd = function (num) {
  chrome.storage.sync.set({"index": num});
}

// Given an object for a pathmark, sets the mark in sync storage
var setMark = function (refObj, index, title) {
  var indLst = [];

  // Send to spiderweb database
  if (sendToSpider) {
    jQuery.ajax({
        type: "POST",
        url: "http://spiderweb.herokuapp.com/add_mark",
        data: JSON.stringify(refObj),
    });
  }
  
  for (item in refObj) {
    indLst.push(index);
    var mark = {};
    var edge = {};
    edge[item] = refObj[item];
    mark[index] = edge;
    pmarks.set(mark);

    index++;
  }
  var pathmark = {}

  // Attach correct list of indices to pathmark
  pathmark[title] = indLst;
  pmarks.set(pathmark);
  setInd(index);
}

var createPathmark = function (index, stripped, title, option) {
  if (option === "links") {
    savePath(stripped, {}, function (output) {
      if (checkPathmark(output)) {
        setMark(output, index, title); 
      }
    });
  } else if (option === "recents") {
    // Ten Minutes Ago is "recent", but allow specify in options page
    saveRecents(longAgo, function (output) {
      if (checkPathmark(output)) {
        setMark(output, index, title); 
      }
    });
  } else if (option === "both") {
    nodes.get(null, function (output) { 
      if (checkPathmark(output)) {
        setMark(output, index, title);
      }
    });
  }
  nodes.set({REF: ""});
}

var checkPathmark = function (pathmark) {
  var result = false;
  for (edge in pathmark) {
    pathmark[edge].forEach(function (data) {
      if (data.in_node) {
         result = true;
      }
    });
  }
  if (!result) {
    chrome.tabs.query({currentWindow: true, active: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {message_type: "bookmark_alert"});
    });
  }
  return result;
}

var removePathmark = function (name) {
  pmarks.get(name, function (pmark) {
    pmark[name].forEach(function (item) {
      pmarks.remove(item.toString());
    });
    pmarks.remove(name);
  });
}

var refreshOptions = function () {
  longAgo = JSON.parse(localStorage["longAgo"]);
  sendToSpider = JSON.parse(localStorage["sendToSpider"]); 
}

//           //
// LISTENERS //
//           //

var runtimeOrExtension = chrome.runtime && chrome.runtime.sendMessage ?
                         'runtime' : 'extension';

chrome[runtimeOrExtension].onMessage.addListener(
  function(request, sender, sendResponse) {
    if (request.message_type === "node") {
      createNode(request.url, request.referrer);
    }
    else if (request.message_type === "pathmark") {
      getInd().done(function (index) {
        nodes.remove("REF", function () {
          createPathmark(index, request.url, request.name, request.opt);
        });
      });
    }
    else if (request.message_type === "newtab") {
      chrome.tabs.create( {url: request.url,
                          active: false});
    }
    else if (request.message_type === "remove") {
      removePathmark(request.mark);
    }
 });

// Send referree to content script 
chrome.webNavigation.onBeforeNavigate.addListener(function(details) {
  if (! /chrome-instant/.test(details.url)) {
    chrome.tabs.query({currentWindow: true, active: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {message_type: "save_ref"});
    });
  }
});

// Don't keep references when opening a new tab
chrome.tabs.onCreated.addListener(function (tab) {
  if (tab.url === "chrome://newtab/") {
    nodes.set({REF: ""});  
  }
});

//                //
//  Context Menu  //
//                //

var contextClick = function (e) {
  var search = e.pageUrl;
  var spiderUrl = "http://spiderweb.herokuapp.com/path/";

  // get spiderweb
  chrome.tabs.create({"url" : spiderUrl + search});
};

chrome.contextMenus.create({
  "title": "Follow the Spiders",
  "contexts": ["page", "selection", "link"],
  "onclick" : contextClick,
});


