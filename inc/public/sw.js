const CACHE_NAME = 'inc-logistics-v1';
const STATIC_CACHE_URLS = [
  '/',
  '/driver',
  '/vendor', 
  '/manifest.json',
  // Add other static assets as needed
];

const API_CACHE_PATTERNS = [
  '/api/heartbeat',
  '/api/delivery-jobs',
  '/api/batch-optimize'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    // Special handling for driver APIs that need offline support
    if (API_CACHE_PATTERNS.some(pattern => url.pathname.startsWith(pattern))) {
      event.respondWith(handleAPIRequest(request));
    } else {
      // Network first for other APIs
      event.respondWith(
        fetch(request).catch(() => 
          new Response(JSON.stringify({ error: 'offline', cached: false }), {
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );
    }
  } else {
    // Cache first for static assets
    event.respondWith(
      caches.match(request)
        .then((response) => response || fetch(request))
        .catch(() => {
          // Fallback for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        })
    );
  }
});

// Handle API requests with offline queue
async function handleAPIRequest(request) {
  const url = new URL(request.url);
  
  try {
    // Try network first
    const response = await fetch(request.clone());
    
    // Cache successful responses for offline access
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // Network failed - handle offline scenarios
    
    if (request.method === 'GET') {
      // Try to serve from cache
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
    
    // For POST requests (like heartbeat updates), queue them
    if (request.method === 'POST') {
      await queueRequest(request);
      return new Response(JSON.stringify({ 
        success: true, 
        offline: true, 
        queued: true,
        message: 'Request queued for when online'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Queue requests for when back online
async function queueRequest(request) {
  const requests = await getQueuedRequests();
  const requestData = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: request.method !== 'GET' ? await request.text() : null,
    timestamp: Date.now()
  };
  
  requests.push(requestData);
  await setQueuedRequests(requests);
}

async function getQueuedRequests() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match('/offline-queue');
    if (response) {
      return await response.json();
    }
  } catch (error) {
    console.error('Error reading offline queue:', error);
  }
  return [];
}

async function setQueuedRequests(requests) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/offline-queue', new Response(JSON.stringify(requests), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    console.error('Error saving offline queue:', error);
  }
}

// Process queued requests when back online
async function processQueuedRequests() {
  const requests = await getQueuedRequests();
  const processed = [];
  
  for (const requestData of requests) {
    try {
      const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: requestData.headers,
        body: requestData.body
      });
      
      if (response.ok) {
        processed.push(requestData);
      }
    } catch (error) {
      console.error('Failed to process queued request:', error);
      break; // Stop processing if network is still unavailable
    }
  }
  
  // Remove processed requests from queue
  if (processed.length > 0) {
    const remaining = requests.filter(req => 
      !processed.some(p => p.timestamp === req.timestamp)
    );
    await setQueuedRequests(remaining);
  }
}

// Listen for online event to process queued requests
self.addEventListener('online', () => {
  processQueuedRequests();
});

// Background sync for processing offline queue
self.addEventListener('sync', (event) => {
  if (event.tag === 'process-offline-queue') {
    event.waitUntil(processQueuedRequests());
  }
});

// Push notifications for delivery updates
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'New update available',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'general',
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'InC Logistics', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});