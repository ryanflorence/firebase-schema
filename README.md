Firebase Schema
===============

- Is your firebase code as big a mess as mine usually is?
- Do you not really know what type of data you save at certain paths?
- Do you even know what your data looks like without logging in?
- Can you access foreign keys and indexes easily?

If you answered "..." to any one of these questions this library is
right for you.

Usage
-----

Define your paths in one place (hey, this looks like a route config):

```js
var Firebase = require('firebase');
var FirebaseSchema = require('firebase-schema');
var { string, number, boolean, list, hash, index, key } = FirebaseSchema.Types;

var HOST = 'http://example.firebaseio.com';

// pass in Firebase so you can use this on the server or client
var schema = FirebaseSchema.create(Firebase, HOST, (child) => {
  child('users', list, (child) => {
    child(':userId', hash, (child) => {
      child('name', string);
      child('groups', index('../../groups'), (child) => {
        child(':groupId', boolean);
      });
    });
  });

  child('groups', list, (child) => {
    child(':groupId', hash, (child) => {
      child('name', string);
      child('members', index('../../users'), (child) => {
        child(':userId', boolean)
      });
    });
  });

  child('messages/:groupId', list, (child) => {
    child(':messageId', hash, (child) => {
      child('content', string);
      child('author', key('../../users/:userId'))
    });
  });

  child('messageFlags', list, (child) => {
    child(':flagId', hash, (child) => {
      child('message', key('../../messages/:groupId/:messageId'));
      child('group', key('../../groups/:groupId'));
      child('count', number);
    });
  });
});
```

- Now its easy to see what kind of data you save and where. Since the
  schema is defined as a nested route structure, we don't have to leave
  the key:value paradigm of Firebase.
- Relationships via `index` and `key` get looked up for you (https://www.firebase.com/docs/web/guide/structuring-data.html)
- Data is validated when you try to `set` or `push` to a path.
- `list`s are automatically converted to an array when you retrieve the
  value, with their keys assigned to `_id`.

```js
var usersRef = schema.createRef('users');
var groupsRef = schema.createRef('groups');
var userId;
var groupId;

usersRef.push({name: 'Ryan'}, () => {
  usersRef.getValue((err, val) => {
    deepEqual(val, [{
      name: 'Ryan',
      // woah what's this? since we did `child('users', list, ...)`
      // we get the values back as an array with their firebase key
      // set as the `_id`
      _id: '-Jev95piCGXV9jX4ellH'
    }])
    userId = val[0]._id;
  });
});

// later

groupsRef.push({name: 123}); // error! should be a string

groupsRef.push({ name: 'cool kids table' }, () => {
  groupsRef.getValue((err, groups) => {
    groupId = groups[0]._id;
    // define a relationship between the group and the user using
    // a `key:true` index (https://www.firebase.com/docs/web/guide/structuring-data.html)
    groupsRef.child(`${groupId}/members/${userId}`).set(true);
    usersRef.child(`${userId}/groups/${groupId}`).set(true);
  });
});

// later

groupsRef.getValue((err, groups) => {
  deepEqual(groups[0], {
    name: 'cool kids table',
    members: { '-Jev95piCGXV9jX4ellH': true },
    _id: '-Jev95pjLLtDmIxbGhcF',
    // woah what's this?
    _indexes: {
      // because we defined `child('members', index(...))` we
      // get an array of paths to the members of this group
      members: [
        'users/-Jev95piCGXV9jX4ellH'
      ]
    }
  }); // true

  // now you can easily go lookup the users from the members
  var userRef = usersRef.child(groups[0]._indexes.members[0]);
});

// keys work similarly
var coolKidMessages = schema.createRef(`messages/${groupId}`);
coolKidMessages.push({
  content: 'guhhhh i hate 3rd period',
  author: userId
});

// later
coolKidMessages.getValue((err, value) => {
  deepEqual(value[0], {
    content: 'guhhhh i hate 3rd period',
    author: '-Jev95piCGXV9jX4ellH',
    _id: '-Jev95pjLLtDmIxbGhcF'
    _links: {
      author: 'users/-Jev95piCGXV9jX4ellH'
    }
  }); // true!
});
```

That's it. That's where this is at. I haven't used it yet in my app, but
am going to soon, will probably need to add in some more of the firebase
API to `createRef`. In the meantime, check out `tests.js` to see
anything I've missed here.

