import{t as e}from"./shaderStore-D-XQlhUT.js";var t=`textureProcessorPixelShader`,n=`#ifdef OPERAND_A_TEXTURE
uniform sampler2D textureA;
#endif
#ifdef OPERAND_B_TEXTURE
uniform sampler2D textureB;
#endif
#if defined(OP_LERP) && defined(LERP_T_TEXTURE)
uniform sampler2D textureT;
#endif
#ifdef OPERAND_A_MATRIX
uniform mat4 textureAMatrix;
#endif
#ifdef OPERAND_B_MATRIX
uniform mat4 textureBMatrix;
#endif
#if defined(OP_LERP) && defined(LERP_T_MATRIX)
uniform mat4 textureTMatrix;
#endif
#if !defined(OPERAND_A_TEXTURE) || defined(OPERAND_A_FACTOR)
uniform vec4 factorA;
#endif
#if !defined(OPERAND_B_TEXTURE) || defined(OPERAND_B_FACTOR)
uniform vec4 factorB;
#endif
#if defined(OP_LERP) && (!defined(LERP_T_TEXTURE) || defined(LERP_T_FACTOR))
uniform vec4 factorT;
#endif
#if defined(OP_MULTI_SCATTER_TO_SINGLE_SCATTER) || defined(OP_SINGLE_SCATTER_TO_MULTI_SCATTER)
uniform float scatterAniso;
#endif
varying vec2 vUV;void main() {vec2 uv=vUV;
#ifdef OPERAND_A_TEXTURE
#ifdef OPERAND_A_MATRIX
vec4 a=texture2D(textureA,(textureAMatrix*vec4(uv,1.0,0.0)).xy);
#else
vec4 a=texture2D(textureA,uv);
#endif
#ifdef OPERAND_A_SRGB
a.rgb=mix(a.rgb/12.92,pow((a.rgb+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),a.rgb));
#endif
#ifdef OPERAND_A_CHANNEL_R
a=vec4(a.rrr,a.a);
#elif defined(OPERAND_A_CHANNEL_G)
a=vec4(a.ggg,a.a);
#elif defined(OPERAND_A_CHANNEL_B)
a=vec4(a.bbb,a.a);
#elif defined(OPERAND_A_CHANNEL_A)
a=a.aaaa;
#endif
#ifdef OPERAND_A_FACTOR
a*=factorA;
#endif
#else
vec4 a=factorA;
#endif
#ifdef OPERAND_B_TEXTURE
#ifdef OPERAND_B_MATRIX
vec4 b=texture2D(textureB,(textureBMatrix*vec4(uv,1.0,0.0)).xy);
#else
vec4 b=texture2D(textureB,uv);
#endif
#ifdef OPERAND_B_SRGB
b.rgb=mix(b.rgb/12.92,pow((b.rgb+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),b.rgb));
#endif
#ifdef OPERAND_B_CHANNEL_R
b=vec4(b.rrr,b.a);
#elif defined(OPERAND_B_CHANNEL_G)
b=vec4(b.ggg,b.a);
#elif defined(OPERAND_B_CHANNEL_B)
b=vec4(b.bbb,b.a);
#elif defined(OPERAND_B_CHANNEL_A)
b=b.aaaa;
#endif
#ifdef OPERAND_B_FACTOR
b*=factorB;
#endif
#else
vec4 b=factorB;
#endif
#ifdef OP_MULTI_SCATTER_TO_SINGLE_SCATTER
#ifdef MULTI_SCATTER_SCALE_B
vec4 multiScatter=a*b;
#else
vec4 multiScatter=a;
#endif
vec3 rhoMs=clamp(multiScatter.rgb,vec3(0.0),vec3(1.0));vec3 s=vec3(4.09712)+4.20863*rhoMs-sqrt(vec3(9.59217)+41.6808*rhoMs+17.7126*rhoMs*rhoMs);s=mix(s,vec3(1.0),vec3(equal(rhoMs,vec3(0.0))));vec4 result=vec4((vec3(1.0)-s*s)/max(vec3(1.0)-scatterAniso*s*s,vec3(0.0000001)),multiScatter.a);
#elif defined(OP_SINGLE_SCATTER_TO_MULTI_SCATTER)
vec3 ssAlbedo=clamp(a.rgb,vec3(0.0),vec3(1.0));vec3 s2=(vec3(1.0)-ssAlbedo)/max(vec3(1.0)-scatterAniso*ssAlbedo,vec3(0.0000001));vec3 sq=sqrt(max(s2,vec3(0.0)));vec4 result=vec4((vec3(1.0)-sq)*(vec3(1.0)-0.139*sq)/(vec3(1.0)+1.17*sq),a.a);
#elif defined(OP_CHANNEL_MAX)
float _cmax=max(max(a.r,a.g),a.b);
#ifdef CHANNEL_MAX_INCLUDE_ALPHA
_cmax=max(_cmax,a.a);vec4 result=vec4(_cmax,_cmax,_cmax,_cmax);
#else
vec4 result=vec4(_cmax,_cmax,_cmax,a.a);
#endif
#elif defined(OP_INVERT)
float _ir=a.r; float _ig=a.g; float _ib=a.b; float _ia=a.a;
#ifdef INVERT_R
_ir=1.0-_ir;
#endif
#ifdef INVERT_G
_ig=1.0-_ig;
#endif
#ifdef INVERT_B
_ib=1.0-_ib;
#endif
#ifdef INVERT_A
_ia=1.0-_ia;
#endif
vec4 result=vec4(_ir,_ig,_ib,_ia);
#elif defined(OP_LERP)
#ifdef LERP_T_TEXTURE
#ifdef LERP_T_MATRIX
vec4 t=texture2D(textureT,(textureTMatrix*vec4(uv,1.0,0.0)).xy);
#else
vec4 t=texture2D(textureT,uv);
#endif
#ifdef LERP_T_SRGB
t.rgb=mix(t.rgb/12.92,pow((t.rgb+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),t.rgb));
#endif
#ifdef LERP_T_CHANNEL_R
t=vec4(t.rrr,t.a);
#elif defined(LERP_T_CHANNEL_G)
t=vec4(t.ggg,t.a);
#elif defined(LERP_T_CHANNEL_B)
t=vec4(t.bbb,t.a);
#elif defined(LERP_T_CHANNEL_A)
t=t.aaaa;
#endif
#ifdef LERP_T_FACTOR
t*=factorT;
#endif
#else
vec4 t=factorT;
#endif
vec4 result=mix(a,b,t);
#elif defined(OP_MAX)
vec4 result=max(a,b);
#elif defined(OP_DIVIDE)
vec4 result=a/max(b,vec4(0.00001));
#elif defined(OP_TRANSMISSION_FRACTION)
vec4 result=a/max(a+b*(vec4(1.0)-a),vec4(0.00001));
#elif defined(OP_THIN_WALLED_TRANSMISSION_WEIGHT)
vec4 result=vec4(a.r*(1.0-b.r));
#elif defined(OP_THIN_WALLED_SUBSURFACE_WEIGHT)
float _transmittedScatter=a.r*b.r;vec4 result=vec4(_transmittedScatter/max(1.0-a.r+_transmittedScatter,0.00001));
#elif defined(OP_TRANSMISSION_SCATTER_ALBEDO)
vec3 _extinction=-log(max(a.rgb,vec3(0.0000001)));vec3 _absorption=_extinction-b.rgb;_extinction-=vec3(min(min(min(_absorption.r,_absorption.g),_absorption.b),0.0));vec4 result=vec4(b.rgb/max(_extinction,vec3(0.00001)),b.a);
#else
vec4 result=a*b;
#endif
#ifdef OUTPUT_MASK_R_ZERO
result.r=0.0;
#endif
#ifdef OUTPUT_MASK_G_ZERO
result.g=0.0;
#endif
#ifdef OUTPUT_MASK_B_ZERO
result.b=0.0;
#endif
#ifdef OUTPUT_MASK_A_ONE
result.a=1.0;
#endif
#ifdef OUTPUT_SRGB
result.rgb=mix(result.rgb*12.92,pow(result.rgb,vec3(1.0/2.4))*1.055-0.055,step(vec3(0.0031308),result.rgb));
#endif
gl_FragColor=result;}
`;e.ShadersStore[t]||(e.ShadersStore[t]=n);var r={name:t,shader:n};export{r as textureProcessorPixelShader};