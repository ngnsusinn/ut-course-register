// app/api/login/route.js
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid JSON in request body" 
        }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const { username, password } = body;
    
    // Validate credentials
    if (!username || !password) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Username and password are required" 
        }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // URL encode parameters
    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const apiUrl = `https://api.ngnsusinn.io.vn/get_token_uth.php?username=${encodedUsername}&password=${encodedPassword}`;

    let resp;
    try {
      resp = await fetch(apiUrl, { 
        method: "GET",
        headers: {
          "Accept": "application/json",
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error("Network error:", error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Network error. Please check your connection." 
        }), 
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Server error: ${resp.status}` 
        }), 
        { 
          status: resp.status,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      console.error("Invalid JSON in response:", error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid response from authentication server" 
        }), 
        { 
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    if (!data.token) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid credentials" 
        }), 
        { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        token: data.token 
      }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error("Login error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Internal server error" 
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}