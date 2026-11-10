self.addEventListener('push',event=>{
 let message={title:'GO Pixiedust',body:'Ada pembaruan untuk akunmu.',url:'/'};
 try{message={...message,...event.data.json()};}catch{}
 event.waitUntil(self.registration.showNotification(message.title,{body:message.body,icon:'/assets/pixiedust-logo.webp',badge:'/assets/pixiedust-logo.webp',data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(clients.length){await clients[0].navigate('/');return clients[0].focus();}return self.clients.openWindow('/');})());
});
