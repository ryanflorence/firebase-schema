var expect = require('expect');
var async = require('async');
var Firebase = require('firebase');
var Schema = require('./src');
var { string, number, boolean, list, hash, index, key } = Schema.Types;
console.log(Date.now());

var _warn = console.warn;
var consoleWarnings = [];
console.warn = function () {
  consoleWarnings.push([].slice.call(arguments, 0));
};

var HOST = 'http://rf-testing.firebaseio.com';
var testRef = new Firebase(`${HOST}/test`);

beforeEach((done) => {
  consoleWarnings = [];
  testRef.remove(() => done())
});

describe('schema', () => {
  it('complains if a url does not match', () => {
    var schema = Schema.create(Firebase, HOST, (child) => {
      child('test', string);
    });
    expect(() => {
      schema.createRef('not-defined')
    }).toThrow(/not found/);
  });

});

describe('ref', () => {
  it('sets and reads from a ref', (done) => {
    var schema = Schema.create(Firebase, HOST, (child) => {
      child('test', string);
    });
    var ref = schema.createRef('test');
    ref.set('foo');
    ref.getValue((err, val) => {
      expect(val).toEqual('foo');
      done();
    });
  });

  it('transforms list children', (done) => {
    var testType = {
      validate () {},
      transform (val) {
        return val + 1;
      }
    };
    var schema = Schema.create(Firebase, HOST, (child) => {
      child('test', list, (child) => {
        child(':id', hash, (child) => {
          child('n', testType);
        });
      });
    });
    var ref = schema.createRef('test');
    ref.push({ n: 10 }, () => {
      ref.getValue((err, val) => {
        expect(val).toEqual([{ n: 11, _id: val[0]._id }]);
        done();
      });
    });
  });

  it('transforms hash children', (done) => {
    var testType = {
      validate () {},
      transform (val) {
        return val + 1;
      }
    };
    var schema = Schema.create(Firebase, HOST, (child) => {
      child('test', hash, (child) => {
        child('n', testType);
      });
    });
    var ref = schema.createRef('test');
    ref.set({ n: 10 }, () => {
      ref.getValue((err, val) => {
        expect(val).toEqual({ n: 11 });
        done();
      });
    });
  });



  describe('getValue', () => {
    it('handles null values', (done) => {
      var schema = Schema.create(Firebase, HOST, (child) => {
        child('test', string);
      });
      var ref = schema.createRef('test');
      ref.getValue((err, val) => {
        expect(val).toEqual(null);
        done();
      });
    });

    it('handles null values for lists', (done) => {
      var schema = Schema.create(Firebase, HOST, (child) => {
        child('test', list, (child) => {
          child(':id', string, (child) => {
            child('blergh', string);
          });
        });
      });
      var ref = schema.createRef('test');
      ref.getValue((err, val) => {
        expect(val).toEqual(null);
        done();
      });
    });

  });

  describe('listen', () => {
    it('listens', (done) => {
      var schema = Schema.create(Firebase, HOST, (child) => {
        child('test', string);
      });
      var ref = schema.createRef('test');
      var listener = ref.listen((err, val) => {
        expect(val).toEqual('foo');
      });
      ref.set('foo', () => {
        listener.dispose();
        done();
      });
    });

    it('stops listening', (done) => {
      var schema = Schema.create(Firebase, HOST, (child) => {
        child('test', string);
      });
      var ref = schema.createRef('test');
      var listenerCalls = 0
      var listener = ref.listen((err, val) => {
        listenerCalls++;
        if (listenerCalls === 1)
          expect(val).toEqual('foo');
        else
          throw new Error('should not have gone this far');
      });
      ref.set('foo', () => {
        listener.dispose();
        ref.set('bar', () => done());
      });
    });
  });

  describe('set', () => {
    it('validates strings', () => {
      var schema = Schema.create(Firebase, HOST, (child) => {
        child('test', string);
      });
      var ref = schema.createRef('test');
      expect(() => ref.set(123)).toThrow(/expected "string" but got "number"/i);
    });

    it('validates numbers', () => {
      var schema = Schema.create(Firebase, HOST, (child) => {
        child('test', number);
      });
      var ref = schema.createRef('test');
      expect(() => ref.set('abc')).toThrow(/expected "number" but got "string"/i);
    });

    describe('hash', () => {
      it('sets a hash', (done) => {
        var schema = Schema.create(Firebase, HOST, (child) => {
          child('test/:id', hash, (child) => {
            child('name', string);
          });
        });
        var ref = schema.createRef('test/ryan');
        ref.set({name: 'Ryan Florence'});
        ref.getValue((err, val) => {
          expect(val).toEqual({name: 'Ryan Florence'});
          done();
        });
      });

      it('validates values', () => {
        var schema = Schema.create(Firebase, HOST, (child) => {
          child('test/:id', hash, (child) => {
            child('name', string);
          });
        });
        var ref = schema.createRef('test/ryan');
        expect(() => ref.set({name: 123})).toThrow(/expected "string" but got "number"/i);
      });
    });
  });

  describe('push', () => {
    describe('list', () => {
      it('pushes nodes to lists', (done) => {
        //ref.set; should throw!
        // need limits
        var schema = Schema.create(Firebase, HOST, (child) => {
          child('test', list, (child) => {
            child(':id', hash, (child) => {
              child('name', string);
            });
          });
        });
        var ref = schema.createRef('test');
        ref.push({ name: 'ryan' });
        ref.getValue((err, val) => {
          var { _id } = val[0];
          expect(val).toEqual([
            { _id, name: 'ryan' }
          ]);
          done();
        });
      });

      it('validates the pushed object values', () => {
        var schema = Schema.create(Firebase, HOST, (child) => {
          child('test', list, (child) => {
            child(':id', hash, (child) => {
              child('name', string);
            });
          });
        });
        var ref = schema.createRef('test');
        expect(() => ref.push({name: 123})).toThrow(/expected "string" but got "number"/i);
      });

      it('throws if you try to push to a non-list path', () => {
        var schema = Schema.create(Firebase, HOST, (child) => {
          child('test', string);
        });
        var ref = schema.createRef('test');
        expect(() => {
          ref.push({})
        }).toThrow(/can't push to \"test\"/i);
      });

      it('throws if you try to push an object with the wrong keys', () => {
        var schema = Schema.create(Firebase, HOST, (child) => {
          child('test', list, (child) => {
            child('name');
          });
        });
        var ref = schema.createRef('test');
        expect(() => {
          ref.push({name: 'ryan', age: 33});
        }).toThrow(/no child path defined/i);
      });
    });
  });
});

describe('relationships', () => {

  var usersRef;
  var groupsRef;
  var messagesRef;
  var flagsRef;
  var userId;
  var groupId;
  var messageId;
  var flagId;

  var schema = Schema.create(Firebase, HOST, (child) => {
    child('test', hash, (child) => {
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
  });

  beforeEach((done) => {
    usersRef = schema.createRef('test/users');
    groupsRef = schema.createRef('test/groups');
    async.parallel([
      (cb) => usersRef.push({name: 'ryan'}, cb),
      (cb) => groupsRef.push({name: 'cool kids'}, cb)
    ], () => {
      async.parallel({
        users (cb) { usersRef.getValue(cb) },
        groups (cb) { groupsRef.getValue(cb) }
      }, (err, results) => {
        userId = results.users[0]._id;
        groupId = results.groups[0]._id;
        async.parallel({
          users (cb) { usersRef.child(`${userId}/groups/${groupId}`).set(true, cb) },
          groups (cb) { groupsRef.child(`${groupId}/members/${userId}`).set(true, cb) },
          messages (cb) {
            messagesRef = schema.createRef(`test/messages/${groupId}`);
            messagesRef.push({ content: 'hello', author: userId }, (err) => {
              messagesRef.getValue(cb);
            });
          }
        }, (err, results) => {
          messageId = results.messages[0]._id;
          flagsRef = schema.createRef(`test/messageFlags`);
          flagsRef.push({ count: 2, group: groupId, message:messageId }, () => {
            flagsRef.getValue((err, flags) => {
              // phew!
              flagId = flags[0]._id;
              done();
            });
          });
        })
      });
    });
  });

  describe('key', () => {
    it('adds links to list values', (done) => {
      flagsRef.getValue((err, flags) => {
        expect(flags[0]._links).toEqual({
          message: `test/messages/${groupId}/${messageId}`,
          group: `test/groups/${groupId}`,
        });
        done();
      });
    });

    it('adds links values', (done) => {
      flagsRef.child(flagId).getValue((err, flag) => {
        var expected = {
          count: 2,
          group: groupId,
          message: messageId,
          _id: flagId,
          _links: {
            message: `test/messages/${groupId}/${messageId}`,
            group: `test/groups/${groupId}`,
          }
        };
        expect(flag._links).toEqual(expected._links);
        done();
      });
    });

    it("warns if it doesn't have all the keys it needs", (done) => {
      flagsRef.push({
        count: 1,
        group: groupId
      }, () => {
        flagsRef.getValue((err, flags) => {
          expect(consoleWarnings.length).toEqual(1);
          done();
        });
      });
    });
  });

  describe('index', () => {
    it('adds indexes to the value', (done) => {
      usersRef.child(userId).getValue((err, user) => {
        expect(user._indexes).toEqual({
          groups: [`test/groups/${groupId}`]
        });
        done();
      });
    });

    it('adds indexes to lists', (done) => {
      usersRef.getValue((err, users) => {
        expect(users[0]._indexes).toEqual({
          groups: [`test/groups/${groupId}`]
        });
        done();
      });
    });

  });
});



//var transactions = store.ref(
  //`/users/${uid}/transactions/${monthId}`
//).listen(this.forceUpdate.bind(this));
//transactions.dispose();

//store.push(`/users/${uid}/transactions/${monthid}`, tx);
//store.set(`/users/${uid}/transactions/${monthid}/${txId}`, tx);

//var user = schema.ref(`/users/${uid}`);
//var txRef = user.ref(`/transactions/${monthid}`).
  //connect(this.forceUpdate.bind(this));

//var account = schema.ref(`/users/${uid}/accounts/${accountId}`);
//account.remove(); // remove all foreignKey's too


