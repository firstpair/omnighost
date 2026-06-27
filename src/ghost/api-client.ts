import { App, requestUrl, RequestUrlResponse } from 'obsidian';
import { GhostPost } from '../types';

/**
 * Ghost Admin API Client
 * Uses Obsidian's requestUrl instead of fetch to bypass CORS
 */
export class GhostAPIClient {
	private apiUrl: string;
	private apiKey: string;
	private app: App;

	constructor(ghostUrl: string, apiKey: string, app: App) {
		this.apiUrl = ghostUrl;
		this.apiKey = apiKey;
		this.app = app;
	}

	/**
	 * Update credentials
	 */
	updateCredentials(ghostUrl: string, apiKey: string): void {
		this.apiUrl = ghostUrl;
		this.apiKey = apiKey;
	}

	/**
	 * Generate JWT token for Ghost Admin API
	 * Format: {id}:{secret}
	 */
	private async generateToken(): Promise<string> {
		if (!this.apiKey) {
			throw new Error('Admin API key not configured');
		}

		// Trim whitespace/newlines accidentally pasted with the key (a very common
		// cause of Ghost "Invalid token"), and split on the FIRST colon only so a
		// stray colon can't corrupt the secret.
		const trimmedKey = this.apiKey.trim();
		const sep = trimmedKey.indexOf(':');
		const id = sep === -1 ? '' : trimmedKey.slice(0, sep).trim();
		const secret = sep === -1 ? '' : trimmedKey.slice(sep + 1).trim();

		if (!id || !secret) {
			throw new Error('Invalid Admin API key format. Expected format: id:secret');
		}

		console.debug('[Ghost JWT] Generating token...');
		console.debug('[Ghost JWT] ID length:', id.length);
		console.debug('[Ghost JWT] Secret length:', secret.length);
		console.debug('[Ghost JWT] Secret is hex?', /^[0-9a-f]+$/i.test(secret));

		// Generate JWT token
		// Header (order matters for some JWT implementations)
		const header = {
			alg: 'HS256',
			kid: id,
			typ: 'JWT'
		};

		// Payload
		// Backdate iat by 10s to tolerate clock skew between the device and the
		// Ghost server (a phone in airplane mode can drift); keep the 5-min expiry.
		const nowSec = Math.floor(Date.now() / 1000);
		const payload = {
			iat: nowSec - 10,
			exp: nowSec + (5 * 60), // 5 minutes
			aud: '/admin/'
		};

		console.debug('[Ghost JWT] Payload:', payload);

		// Encode header and payload
		const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
		const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));

		console.debug('[Ghost JWT] Encoded header:', encodedHeader);
		console.debug('[Ghost JWT] Encoded payload:', encodedPayload);

		// Create signature
		const unsignedToken = `${encodedHeader}.${encodedPayload}`;
		const signature = await this.createSignature(unsignedToken, secret);

		console.debug('[Ghost JWT] Signature:', signature);

		const token = `${unsignedToken}.${signature}`;
		console.debug('[Ghost JWT] Final token length:', token.length);

		return token;
	}

	/**
	 * Base64 URL encode
	 */
	private base64UrlEncode(str: string): string {
		return this.base64UrlFromBytes(new TextEncoder().encode(str));
	}

	/**
	 * Base64URL-encode raw bytes using the WebView-safe `btoa` global.
	 * Node's `Buffer` is unavailable on Obsidian mobile (iOS/Android), so we
	 * build a binary string from the bytes and encode with the standard `btoa`.
	 */
	private base64UrlFromBytes(bytes: Uint8Array): string {
		let binary = '';
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary)
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=/g, '');
	}

	/**
	 * Convert hex string to buffer
	 */
	private hexToBuffer(hex: string): Uint8Array {
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < hex.length; i += 2) {
			bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
		}
		return bytes;
	}

	/**
	 * Create HMAC SHA256 signature
	 */
	private async createSignature(data: string, secret: string): Promise<string> {
		const encoder = new TextEncoder();

		// Ghost Admin API secret is in hex format, need to convert to buffer
		const keyData = this.hexToBuffer(secret);
		const messageData = encoder.encode(data);

		// Import key - buffer coercion needed for TypeScript compatibility
		const key = await crypto.subtle.importKey(
			'raw',
			keyData.buffer as ArrayBuffer,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);

		// Sign
		const signature = await crypto.subtle.sign('HMAC', key, messageData);

		// Convert to base64url (Buffer-free for mobile/iOS compatibility)
		return this.base64UrlFromBytes(new Uint8Array(signature));
	}

	/**
	 * Make authenticated request to Ghost Admin API
	 */
	private async makeRequest(
		endpoint: string,
		method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
		body?: unknown
	): Promise<RequestUrlResponse> {
		const token = await this.generateToken();
		const url = `${this.apiUrl}/ghost/api/admin${endpoint}`;

		const headers: Record<string, string> = {
			'Authorization': `Ghost ${token}`,
			'Content-Type': 'application/json',
			'Accept-Version': 'v5.0'
		};

		const options: Parameters<typeof requestUrl>[0] = {
			url,
			method,
			headers,
			throw: false // Don't throw on HTTP errors, we'll handle them
		};

		if (body) {
			options.body = JSON.stringify(body);
		}

		return await requestUrl(options);
	}

	/**
	 * Upload an image to Ghost's Images API and return its public URL.
	 *
	 * The multipart/form-data body is built by hand as a byte array so this works
	 * in the Obsidian mobile WebView (iOS/Android): no Node `Buffer`, no `FormData`.
	 */
	async uploadImage(data: ArrayBuffer, filename: string, mimeType: string): Promise<string> {
		const token = await this.generateToken();
		const url = `${this.apiUrl}/ghost/api/admin/images/upload/`;
		const boundary = `----GhostWriterManager${Math.random().toString(16).slice(2)}`;

		const encoder = new TextEncoder();
		const head = encoder.encode(
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
			`Content-Type: ${mimeType}\r\n\r\n`
		);
		const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
		const image = new Uint8Array(data);

		const body = new Uint8Array(head.length + image.length + tail.length);
		body.set(head, 0);
		body.set(image, head.length);
		body.set(tail, head.length + image.length);

		const response = await requestUrl({
			url,
			method: 'POST',
			headers: {
				'Authorization': `Ghost ${token}`,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Accept-Version': 'v5.0'
			},
			body: body.buffer,
			throw: false
		});

		if (response.status !== 201 && response.status !== 200) {
			throw new Error(`Image upload failed: ${response.status} ${response.text}`);
		}

		const uploaded = (response.json as { images?: { url: string }[] })?.images?.[0]?.url;
		if (!uploaded) {
			throw new Error(`Image upload returned no URL: ${response.text}`);
		}
		return uploaded;
	}

	/**
	 * Look up a post by its slug. Returns null when no post has that slug.
	 * Used to update an existing post instead of creating a duplicate.
	 */
	async getPostBySlug(slug: string): Promise<GhostPost | null> {
		const endpoint = `/posts/slug/${encodeURIComponent(slug)}/?formats=html,lexical&include=tags`;
		const response = await this.makeRequest(endpoint);
		if (response.status === 404) {
			return null;
		}
		if (response.status !== 200) {
			throw new Error(`Failed to look up post by slug: ${response.status} ${response.text}`);
		}
		const data = response.json as { posts: GhostPost[] };
		return data.posts?.[0] ?? null;
	}

	/**
	 * Test connection to Ghost Admin API
	 */
	async testConnection(): Promise<boolean> {
		try {
			const response = await this.makeRequest('/site/');

			if (response.status === 200) {
				return true;
			}

			console.error('Ghost connection test failed:', response.status, response.text);
			return false;
		} catch (error) {
			console.error('Ghost connection test error:', error);
			return false;
		}
	}

	/**
	 * Get all posts
	 */
	async getPosts(filter?: string, limit: number | 'all' = 15, order?: string): Promise<GhostPost[]> {
		try {
			let endpoint = `/posts/?formats=html,lexical&include=tags&limit=${limit}`;
			if (filter) {
				endpoint += `&filter=${encodeURIComponent(filter)}`;
			}
			if (order) {
				endpoint += `&order=${encodeURIComponent(order)}`;
			}

			const response = await this.makeRequest(endpoint);

			if (response.status !== 200) {
				throw new Error(`Failed to fetch posts: ${response.status} ${response.text}`);
			}

			const data = response.json as { posts: GhostPost[] };
			return data.posts || [];
		} catch (error) {
			console.error('Error fetching posts:', error);
			throw error;
		}
	}

	/**
	 * Get a single post by ID
	 */
	async getPost(postId: string): Promise<GhostPost> {
		try {
			const endpoint = `/posts/${postId}/?formats=html,lexical&include=tags`;
			const response = await this.makeRequest(endpoint);

			if (response.status !== 200) {
				throw new Error(`Failed to fetch post: ${response.status} ${response.text}`);
			}

			const data = response.json as { posts: GhostPost[] };
			return data.posts[0];
		} catch (error) {
			console.error('Error fetching post:', error);
			throw error;
		}
	}

	/**
	 * Create a new post
	 */
	async createPost(post: Partial<GhostPost>): Promise<GhostPost> {
		try {
			const response = await this.makeRequest('/posts/', 'POST', { posts: [post] });

			if (response.status !== 201) {
				throw new Error(`Failed to create post: ${response.status} ${response.text}`);
			}

			const data = response.json as { posts: GhostPost[] };
			return data.posts[0];
		} catch (error) {
			console.error('Error creating post:', error);
			throw error;
		}
	}

	/**
	 * Update an existing post
	 */
	async updatePost(postId: string, post: Partial<GhostPost>): Promise<GhostPost> {
		try {
			// First, get the current post to retrieve updated_at
			const currentPost = await this.getPost(postId);

			// Include updated_at from current post for version control
			const postWithVersion = {
				...post,
				updated_at: currentPost.updated_at
			};

			console.debug('[Ghost API] Sending update with fields:', Object.keys(postWithVersion));
			console.debug('[Ghost API] Excerpt value:', postWithVersion.excerpt);
			console.debug('[Ghost API] Full post data:', JSON.stringify(postWithVersion, null, 2).substring(0, 500));

			const response = await this.makeRequest(`/posts/${postId}/`, 'PUT', { posts: [postWithVersion] });

			if (response.status !== 200) {
				throw new Error(`Failed to update post: ${response.status} ${response.text}`);
			}

			const data = response.json as { posts: GhostPost[] };
			return data.posts[0];
		} catch (error) {
			console.error('Error updating post:', error);
			throw error;
		}
	}

	/**
	 * Delete a post
	 */
	async deletePost(postId: string): Promise<void> {
		try {
			const response = await this.makeRequest(`/posts/${postId}/`, 'DELETE');

			if (response.status !== 204) {
				throw new Error(`Failed to delete post: ${response.status} ${response.text}`);
			}
		} catch (error) {
			console.error('Error deleting post:', error);
			throw error;
		}
	}
}
