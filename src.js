var router = require('nested-router');
var pathToRegexp = require('path-to-regexp');
var { resolve } = require('path-browserify');

var cannotPush = (obj, path) => {
  error(true, `Can't push to "${path}". Use "set"`);
};

var isTypeof = (desiredType) => {
  return {
    validate (val, path) {
      var actualType = typeof val;
      error(actualType !== desiredType, `Validation Error: Invalid value, expected "${desiredType}" but got "${actualType}" for path "${path}".`);
    }
  };
};

var toArray$ = (obj) => {
  return Object.keys(obj).reduce((arr, key) => {
    obj[key]._id = key;
    arr.push(obj[key]);
    return arr;
  }, []);
};

var list = {
  validate (val, path) {
    error(true, 'Cannot call `set` on a `list`, use `ref.push`. Path '+path);
  },

  transform (snapshotVal) {
    return toArray$(snapshotVal);
  },

  toString () {
    return 'list';
  }
};

var hash = {
  toString () {
    return 'hash';
  },

  validate (obj, path) {
    error('object' !== typeof obj, `Validation Error: received non-object for path "${path}"`);
  }
};

var index = (path) => {
  return {
    toString() {
      return 'index';
    },

    getPath () {
      return path;
    }
  }
};

var key = (path) => {
  return {
    toString () {
      return 'key';
    },

    validate (val) {
      error(typeof val !== 'string', `Validation Error: keys must be strings, got "${typeof val}"`);
    },

    getPath () {
      return path;
    }
  }
};

var createRefForReals = (Firebase, path, routes, host) => {
  var matchInfo = router.match(path, routes);
  error(matchInfo === null, `The path "${path}" was not found in your schema`);
  var handler = getLast(matchInfo.handlers);
  var firebaseRef = new Firebase(`${host}/${path}`);
  var set = (val, cb) => {
    handler.validate(val, path);
    if (handler === hash)
      validateHash(val, path, routes, matchInfo);
    firebaseRef.set(val, cb);
  };
  var push = (obj, cb) => {
    validatePush(obj, path, routes, matchInfo);
    firebaseRef.push(obj, cb);
  };
  var parse = (snapshot, cb) => {
    var snapshotVal = snapshot.val();
    if (snapshotVal === null)
      return cb(null, null);
    // all of this is garbage, each type should handle the transforms
    var transformed = handler.transform ? handler.transform(snapshotVal) : snapshotVal;
    if (matchInfo.route.handler == 'list')
      transformed = transformListChildren(transformed, routes, path);
    if (matchInfo.route.handler == 'hash')
      transformed = transformHash(transformed, routes, path);
    addIdForDirectRefToListChild(transformed, matchInfo.route, path);
    addRelationships(transformed, matchInfo);
    addIndexes(transformed, matchInfo);
    cb(null, transformed);
  };
  var getValue = (cb) => {
    firebaseRef.once('value', (snapshot) => {
      parse(snapshot, cb);
    });
  };
  var child = (childPath) => {
    return createRefForReals(Firebase, `${path}/${childPath}`, routes, host);
  };
  var listen = (userHandler) => {
    var handler = snapshot => parse(snapshot, userHandler);
    firebaseRef.on('value', handler);
    return {
      dispose () {
        firebaseRef.off('value', handler);
      }
    };
  };
  var removeChangeListener = () => {
  };
  return { set:set, getValue, push, child, listen };
};

var transformHash = (child, routes, path) => {
  Object.keys(child).forEach((key) => {
    var childPath = `${path}/${key}`;
    var matchInfo = router.match(childPath, routes);
    var handler = matchInfo.route.handler;
    if (handler.transform)
      child[key] = handler.transform(child[key]);
  });
  return child;
};

var transformListChildren = (children, routes, path) => {
  // should probably recurse here
  return children.map((child) => {
    Object.keys(child).forEach((key) => {
      if (key === '_id') // hmmm, I am dubious of much more of this
        return;
      var childPath = `${path}/${child._id}/${key}`;
      var matchInfo = router.match(childPath, routes);
      var handler = matchInfo.route.handler;
      if (handler.transform)
        child[key] = handler.transform(child[key]);
    });
    return child;
  });
};

var addIdForDirectRefToListChild = (val, route, path) => {
  if (route.parent && route.parent.handler == 'list')
    val._id = path.split('/').reverse()[0];
};

var error = (shouldThrow, message) => {
  if (shouldThrow)
    throw new Error(`FirebaseSchema Error: ${message}`);
};

var getLast = (arr) => {
  return arr[arr.length - 1];
};

var validatePush = (obj, path, routes, matchInfo) => {
  error(getLast(matchInfo.handlers) !== list, `Can't push to "${path}", use the "list" type.`);
  Object.keys(obj).forEach((key) => {
    var childPath = `${path}/:id/${key}`;
    validateChild(obj[key], childPath, routes, matchInfo);
  });
};

var validateHash = (obj, path, routes, matchInfo) => {
  Object.keys(obj).forEach((key) => {
    var childPath = `${path}/${key}`;
    validateChild(obj[key], childPath, routes, matchInfo);
  });
};

var validateChild = (val, path, routes, matchInfo) => {
  var matchInfo = router.match(path, routes);
  error(matchInfo === null, `No child path defined at "${path}"`);
  var handler = getLast(matchInfo.handlers);
  handler.validate(val, path);
};

var addIndexes = (val, matchInfo, depth) => {
  depth = depth === undefined ? 0 : depth;
  if (Array.isArray(val)) {
    val.forEach(v => addIndexes(v, matchInfo, depth + 1));
    return;
  }
  var path = matchInfo.path;
  var dependencies = [];
  recurseRoutes(matchInfo.route.children, (route) => {
    if (route.handler == 'index') {
      var relativePath = shrinkPath(route.handler.getPath(), depth);
      var refPath = resolve('/', path, relativePath).substr(1);
      var valueKey = route.path.replace(route.parent.path, '').substr(1);
      var childRoute = route.children[0];
      var childKey = childRoute.path.replace(childRoute.parent.path, '').substr(2)
      if (!val[valueKey]) // nothing in the index yet
        return;
      var relationships = Object.keys(val[valueKey]).reduce((relationships, key) => {
        relationships.push(`${refPath}/${key}`);
        return relationships;
      }, []);
      val._indexes = val._indexes || {};
      val._indexes[valueKey] = relationships;
    }
  });
};

var shrinkPath = (path, depth) => {
  var c = depth;
  while (c > 0) {
    path = path.replace(/^..\//, '');
    c--;
  }
  return path;
};

var addRelationships = (val, matchInfo, depth) => {
  // sometimes I know what I'm doing, other times there's this.
  // Might have some recursion issues? My data isn't that nested
  // so I don't know/don't care ... yet.

  depth = depth === undefined ? 0 : depth;
  if (Array.isArray(val)) {
    val.forEach((v) => addRelationships(v, matchInfo, depth + 1));
    return;
  }
  var path = matchInfo.path;
  var dependencies = []; // terrible name
  recurseRoutes(matchInfo.route.children, (route) => {
    if (route.handler == 'key') {
      var relativePath = shrinkPath(route.handler.getPath(), depth);
      dependencies.push({
        refPath: resolve('/', path, relativePath).substr(1),
        valueKey: route.path.replace(route.parent.path, '').substr(1)
      })
    }
  });
  if (dependencies.length === 0)
    return
  var params = dependencies.reduce((params, dependency) => {
    var keys = [];
    pathToRegexp(dependency.refPath, keys);
    keys.forEach((key) => {
      params[key.name] = val[dependency.valueKey];
    });
    return params;
  }, {});
  var links = dependencies.reduce((links, dependency) => {
    links[dependency.valueKey] = replaceParams(dependency.refPath, params);
    return links;
  }, {});
  Object.keys(params).forEach((param) => {
    if (params[param] === undefined)
      console.warn(`Relationship Error: missing key "${param}" at path "${path}":`, val);
  });
  val._links = links;
};

var replaceParams = (path, params) => {
  for (var key in params)
    path = path.replace(':'+key, params[key]);
  return path;
};

var recurseRoutes = (routes, iterate) => {
  routes.forEach((route) => {
    iterate(route);
    if (route.children)
      recurseRoutes(route.children, iterate);
  });
};

exports.create = (Firebase, host, getRoutes) => {
  var routes = router.map(getRoutes);
  var createRef = path => createRefForReals(Firebase, path, routes, host);
  return { createRef };
};

exports.Types = {
  string: isTypeof('string'),
  number: isTypeof('number'),
  boolean: isTypeof('boolean'),
  list,
  hash,
  index,
  key
};

