"use strict";

var router = require("nested-router");
var pathToRegexp = require("path-to-regexp");
var _ref = require("path-browserify");

var resolve = _ref.resolve;


var cannotPush = function (obj, path) {
  error(true, "Can't push to \"" + path + "\". Use \"set\"");
};

var isTypeof = function (desiredType) {
  return {
    validate: function (val, path) {
      var actualType = typeof val;
      error(actualType !== desiredType, "Validation Error: Invalid value, expected \"" + desiredType + "\" but got \"" + actualType + "\" for path \"" + path + "\".");
    }
  };
};

var toArray$ = function (obj) {
  return Object.keys(obj).reduce(function (arr, key) {
    obj[key]._id = key;
    arr.push(obj[key]);
    return arr;
  }, []);
};

var list = {
  validate: function (val, path) {
    error(true, "Cannot call `set` on a `list`, use `ref.push`. Path " + path);
  },

  transform: function (snapshotVal) {
    return toArray$(snapshotVal);
  },

  toString: function () {
    return "list";
  }
};

var hash = {
  toString: function () {
    return "hash";
  },

  validate: function (obj, path) {
    error("object" !== typeof obj, "Validation Error: received non-object for path \"" + path + "\"");
  }
};

var index = function (path) {
  return {
    toString: function () {
      return "index";
    },

    getPath: function () {
      return path;
    }
  };
};

var key = function (path) {
  return {
    toString: function () {
      return "key";
    },

    validate: function (val) {
      error(typeof val !== "string", "Validation Error: keys must be strings, got \"" + typeof val + "\"");
    },

    getPath: function () {
      return path;
    }
  };
};

var createRefForReals = function (Firebase, path, routes, host) {
  var matchInfo = router.match(path, routes);
  error(matchInfo === null, "The path \"" + path + "\" was not found in your schema");
  var handler = getLast(matchInfo.handlers);
  var firebaseRef = new Firebase("" + host + "/" + path);
  var set = function (val, cb) {
    handler.validate(val, path);
    if (handler === hash) validateHash(val, path, routes, matchInfo);
    firebaseRef.set(val, cb);
  };
  var push = function (obj, cb) {
    validatePush(obj, path, routes, matchInfo);
    firebaseRef.push(obj, cb);
  };
  var parse = function (snapshot, cb) {
    var snapshotVal = snapshot.val();
    if (snapshotVal === null) return cb(null, null);
    // all of this is garbage, each type should handle the transforms
    var transformed = handler.transform ? handler.transform(snapshotVal) : snapshotVal;
    if (matchInfo.route.handler == "list") transformed = transformListChildren(transformed, routes, path);
    if (matchInfo.route.handler == "hash") transformed = transformHash(transformed, routes, path);
    addIdForDirectRefToListChild(transformed, matchInfo.route, path);
    addRelationships(transformed, matchInfo);
    addIndexes(transformed, matchInfo);
    cb(null, transformed);
  };
  var getValue = function (cb) {
    firebaseRef.once("value", function (snapshot) {
      parse(snapshot, cb);
    });
  };
  var child = function (childPath) {
    return createRefForReals(Firebase, "" + path + "/" + childPath, routes, host);
  };
  var listen = function (userHandler) {
    var handler = function (snapshot) {
      return parse(snapshot, userHandler);
    };
    firebaseRef.on("value", handler);
    return {
      dispose: function () {
        firebaseRef.off("value", handler);
      }
    };
  };
  var removeChangeListener = function () {};
  return { set: set, getValue: getValue, push: push, child: child, listen: listen };
};

var transformHash = function (child, routes, path) {
  Object.keys(child).forEach(function (key) {
    var childPath = "" + path + "/" + key;
    var matchInfo = router.match(childPath, routes);
    var handler = matchInfo.route.handler;
    if (handler.transform) child[key] = handler.transform(child[key]);
  });
  return child;
};

var transformListChildren = function (children, routes, path) {
  // should probably recurse here
  return children.map(function (child) {
    Object.keys(child).forEach(function (key) {
      if (key === "_id") // hmmm, I am dubious of much more of this
        return;
      var childPath = "" + path + "/" + child._id + "/" + key;
      var matchInfo = router.match(childPath, routes);
      var handler = matchInfo.route.handler;
      if (handler.transform) child[key] = handler.transform(child[key]);
    });
    return child;
  });
};

var addIdForDirectRefToListChild = function (val, route, path) {
  if (route.parent && route.parent.handler == "list") val._id = path.split("/").reverse()[0];
};

var error = function (shouldThrow, message) {
  if (shouldThrow) throw new Error("FirebaseSchema Error: " + message);
};

var getLast = function (arr) {
  return arr[arr.length - 1];
};

var validatePush = function (obj, path, routes, matchInfo) {
  error(getLast(matchInfo.handlers) !== list, "Can't push to \"" + path + "\", use the \"list\" type.");
  Object.keys(obj).forEach(function (key) {
    var childPath = "" + path + "/:id/" + key;
    validateChild(obj[key], childPath, routes, matchInfo);
  });
};

var validateHash = function (obj, path, routes, matchInfo) {
  Object.keys(obj).forEach(function (key) {
    var childPath = "" + path + "/" + key;
    validateChild(obj[key], childPath, routes, matchInfo);
  });
};

var validateChild = function (val, path, routes, matchInfo) {
  var matchInfo = router.match(path, routes);
  error(matchInfo === null, "No child path defined at \"" + path + "\"");
  var handler = getLast(matchInfo.handlers);
  handler.validate(val, path);
};

var addIndexes = function (val, matchInfo, depth) {
  depth = depth === undefined ? 0 : depth;
  if (Array.isArray(val)) {
    val.forEach(function (v) {
      return addIndexes(v, matchInfo, depth + 1);
    });
    return;
  }
  var path = matchInfo.path;
  var dependencies = [];
  recurseRoutes(matchInfo.route.children, function (route) {
    if (route.handler == "index") {
      var relativePath = shrinkPath(route.handler.getPath(), depth);
      var refPath = resolve("/", path, relativePath).substr(1);
      var valueKey = route.path.replace(route.parent.path, "").substr(1);
      var childRoute = route.children[0];
      var childKey = childRoute.path.replace(childRoute.parent.path, "").substr(2);
      if (!val[valueKey]) // nothing in the index yet
        return;
      var relationships = Object.keys(val[valueKey]).reduce(function (relationships, key) {
        relationships.push("" + refPath + "/" + key);
        return relationships;
      }, []);
      val._indexes = val._indexes || {};
      val._indexes[valueKey] = relationships;
    }
  });
};

var shrinkPath = function (path, depth) {
  var c = depth;
  while (c > 0) {
    path = path.replace(/^..\//, "");
    c--;
  }
  return path;
};

var addRelationships = function (val, matchInfo, depth) {
  // sometimes I know what I'm doing, other times there's this.
  // Might have some recursion issues? My data isn't that nested
  // so I don't know/don't care ... yet.

  depth = depth === undefined ? 0 : depth;
  if (Array.isArray(val)) {
    val.forEach(function (v) {
      return addRelationships(v, matchInfo, depth + 1);
    });
    return;
  }
  var path = matchInfo.path;
  var dependencies = []; // terrible name
  recurseRoutes(matchInfo.route.children, function (route) {
    if (route.handler == "key") {
      var relativePath = shrinkPath(route.handler.getPath(), depth);
      dependencies.push({
        refPath: resolve("/", path, relativePath).substr(1),
        valueKey: route.path.replace(route.parent.path, "").substr(1)
      });
    }
  });
  if (dependencies.length === 0) return;
  var params = dependencies.reduce(function (params, dependency) {
    var keys = [];
    pathToRegexp(dependency.refPath, keys);
    keys.forEach(function (key) {
      params[key.name] = val[dependency.valueKey];
    });
    return params;
  }, {});
  var links = dependencies.reduce(function (links, dependency) {
    links[dependency.valueKey] = replaceParams(dependency.refPath, params);
    return links;
  }, {});
  Object.keys(params).forEach(function (param) {
    if (params[param] === undefined) console.warn("Relationship Error: missing key \"" + param + "\" at path \"" + path + "\":", val);
  });
  val._links = links;
};

var replaceParams = function (path, params) {
  for (var key in params) path = path.replace(":" + key, params[key]);
  return path;
};

var recurseRoutes = function (routes, iterate) {
  routes.forEach(function (route) {
    iterate(route);
    if (route.children) recurseRoutes(route.children, iterate);
  });
};

exports.create = function (Firebase, host, getRoutes) {
  var routes = router.map(getRoutes);
  var createRef = function (path) {
    return createRefForReals(Firebase, path, routes, host);
  };
  return { createRef: createRef };
};

exports.Types = {
  string: isTypeof("string"),
  number: isTypeof("number"),
  boolean: isTypeof("boolean"),
  list: list,
  hash: hash,
  index: index,
  key: key
};

