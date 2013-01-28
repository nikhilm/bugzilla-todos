function User(username, limit) {
   this.username = username;
   this.name = this.username.replace(/@.+/, "");
   this.limit = limit;

   this.client = bz.createClient({
      username: username
   });
}

User.prototype = {
   fields : 'id,summary,status,resolution,last_change_time'
}

User.prototype.component = function(product, component, callback) {
   this.client.searchBugs({
      product: product,
      component: component,
      include_fields: this.fields,
      limit: this.limit,
      order: "changeddate DESC",
   }, callback);
}

User.prototype.bugs = function(methods, callback) {
   var query = {
      email1: this.username,
      email1_type: "equals",
      order: "changeddate DESC",
      limit: this.limit,
      include_fields: this.fields
   };

   if (methods.indexOf('cced') >= 0) {
      query['email1_cc'] = 1;
   }
   if (methods.indexOf('assigned') >= 0) {
      query['email1_assigned_to'] = 1;
   }
   if (methods.indexOf('reporter') >= 0) {
      query['email1_reporter'] = 1;
   }
   this.client.searchBugs(query, callback);
}

User.prototype.requests = function(callback) {
   this.client.searchBugs({
      'field0-0-0': 'flag.requestee',
      'type0-0-0': 'equals',
      'value0-0-0': this.username,
      status: ['NEW','UNCONFIRMED','REOPENED', 'ASSIGNED'],
      include_fields: 'id,summary,status,resolution,last_change_time,attachments'
   },
   function(err, bugs) {
      if (err) {
         return callback(err);
      }

      var requests = [];

      bugs.forEach(function(bug) {
         // only add attachments with this user as requestee
         if (!bug.attachments) {
            return;
         }
         /* group attachments together for this bug */
         var atts = [];
         bug.attachments.forEach(function(att) {
            if (att.is_obsolete || !att.flags) {
               return;
            }
            att.flags.forEach(function(flag) {
               if (flag.requestee && flag.requestee.name == this.name
                   && flag.status == "?") {
                  att.bug = bug;
                  att.type = flag.name;
                  att.time = att.last_change_time;
                  atts.push(att);
               }
            });
         });

         if (atts.length) {
            requests.push({
               bug: bug,
               attachments: atts,
               time: atts[0].last_change_time
            })
         }
      });
      requests.sort(utils.byTime);

      callback(null, requests);
   });
}

User.prototype.needsCheckin = function(callback) {
   this.client.searchBugs({
      'field0-0-0': 'attachment.attacher',
      'type0-0-0': 'equals',
      'value0-0-0': this.username,
      'field0-1-0': 'whiteboard',
      'type0-1-0': 'not_contains',
      'value0-1-0': 'fixed',
      'field0-2-0': 'flagtypes.name',
      'type0-2-0': 'substring',
      'value0-2-0': 'review+',
      status: ['NEW','UNCONFIRMED','REOPENED', 'ASSIGNED'],
      include_fields: 'id,summary,status,resolution,last_change_time,attachments'
   },
   function(err, bugs) {
      if (err) { return callback(err); }

      var requests = [];

      bugs.forEach(function(bug) {
         var atts = [];
         bug.attachments.forEach(function(att) {
            if (att.is_obsolete || !att.is_patch || !att.flags
                || att.attacher.name != this.name) {
               return;
            }
            att.bug = bug;
            atts.push(att);
         });

         if (atts.length) {
            requests.push({
               bug: bug,
               attachments: atts,
               time: atts[0].last_change_time
            })
         }
      });
      requests.sort(utils.byTime);

      callback(null, requests);
  });
}

User.prototype.awaitingReview = function(callback) {
   this.client.searchBugs({
      'field0-0-0': 'attachment.attacher',
      'type0-0-0': 'equals',
      'value0-0-0': this.username,
      'field0-1-0': 'flagtypes.name',
      'type0-1-0': 'contains',
      'value0-1-0': '?',
      status: ['NEW','UNCONFIRMED','REOPENED', 'ASSIGNED'],
      include_fields: 'id,summary,status,resolution,last_change_time,attachments'
   },
   function(err, bugs) {
      if (err) { return callback(err); }

      var requests = [];
      bugs.forEach(function(bug) {
         var atts = [];
         bug.attachments.forEach(function(att) {
            if (att.is_obsolete || !att.is_patch || !att.flags
                || att.attacher.name != this.name) {
               return;
            }
            att.flags.forEach(function(flag) {
               if (flag.status == "?") {
                  att.bug = bug;
                  atts.push(att);
               }
            })
         });

         if (atts.length) {
            requests.push({
               bug: bug,
               attachments: atts,
               time: atts[0].last_change_time
            })
         }
      });
      requests.sort(utils.byTime);

      callback(null, requests);
   });
}

User.prototype.awaitingFlag = function(callback) {
   this.client.searchBugs({
      'field0-0-0': 'flag.setter',
      'type0-0-0': 'equals',
      'value0-0-0': this.username,
      'field0-1-0': 'flagtypes.name',
      'type0-1-0': 'contains',
      'value0-1-0': '?',
      status: ['NEW','UNCONFIRMED','REOPENED', 'ASSIGNED'],
      include_fields: 'id,summary,status,resolution,last_change_time,flags'
   }, function(err, bugs) {
      bugs = bugs.map(function(bug) {
         return {
            bug: bug,
            time: bug.last_change_time
         }
      })
      bugs.sort(utils.byTime);

      callback(null, bugs);
   })
}

User.prototype.awaiting = function(callback) {
   var self = this;
   this.awaitingFlag(function(err, flagBugs) {
      if (err) return callback(err);

      self.awaitingReview(function(err, reviewBugs) {
         if (err) return callback(err);

         var bugs = flagBugs.concat(reviewBugs);
         bugs.sort(utils.byTime);

         callback(null, bugs);
      })
   })
}

User.prototype.needsPatch = function(callback) {
   var query = {
      email1: this.username,
      email1_type: "equals",
      email1_assigned_to: 1,
      order: "changeddate DESC",
      status: ['NEW','UNCONFIRMED','REOPENED', 'ASSIGNED'],
      include_fields: 'id,summary,status,resolution,last_change_time,attachments'
   };
   this.client.searchBugs(query, function(err, bugs) {
      if (err) { return callback(err); }

      var bugsNoPatches = bugs.filter(function(bug) {
         var hasPatch = bug.attachments && bug.attachments.some(function(att) {
            return att.is_patch && att.flags;
         });
         return !hasPatch;
      });

      bugsNoPatches.sort(function (b1, b2) {
         return new Date(b2.last_change_time) - new Date(b1.last_change_time);
      });

      bugsNoPatches = bugsNoPatches.map(function(bug) {
         return { bug: bug };
      })
      callback(null, bugsNoPatches);
   });
}

User.prototype.flagged = function(callback) {
   this.client.searchBugs({
      'field0-0-0': 'flag.requestee',
      'type0-0-0': 'equals',
      'value0-0-0': this.username,
      include_fields: 'id,summary,status,resolution,last_change_time,flags'
   },
   function(err, bugs) {
      if (err) { return callback(err); }
      var flags = [];

      bugs.forEach(function(bug) {
         if (!bug.flags) {
            return;
         }
         bug.flags.forEach(function(flag) {
            if (flag.requestee && flag.requestee.name == this.name) {
               flags.push({
                  name: flag.name,
                  flag: flag,
                  bug: bug,
                  time: bug.last_change_time
               })
            }
         });
      });
      flags.sort(function(f1, f2) {
         return new Date(f2.time) - new Date(f1.time);
      });

      callback(null, flags);
   });
}
