// cosine distance implementation for blockcollider
// lgray@github September 2018
// permission granted to use under MIT license

#include <iostream>

__host__ __device__ double cosine_distance_cu(uint8_t work[BLAKE2B_OUTBYTES],
                                              uint8_t comp[BLAKE2B_OUTBYTES],
                                              size_t bytes_size=BLAKE2B_OUTBYTES) {

  static uint32_t num_to_code[16] = {48,49,50,51,52,53,54,55,56,57,97,98,99,100,101,102};
  
  double acc(0), num(0), den(0);
  double norm_work_t, norm_work_s, norm_work_r;
  double norm_comp_t, norm_comp_s, norm_comp_r;
  #pragma unroll
  for(unsigned j = 2; j < BLAKE2B_OUTBYTES/16; ++j) {
    uint32_t jwork1(0), jwork2(0), jcomp1(0), jcomp2(0);
    num = 0; den = 0; 
    norm_work_t = 0; norm_work_s = 0; norm_work_r = 0;
    norm_comp_t = 0; norm_comp_s = 0; norm_comp_r = 0;
    #pragma unroll
    for( unsigned i = 0; i < 16; ++i ) {      
      unsigned offset_fwd = 16*j + i;      
      unsigned offset_bkw = (16*(4-j-1)) + i;
      unsigned work_lcl = work[offset_bkw];
      unsigned comp_lcl = comp[offset_fwd];
      jwork2 = num_to_code[work_lcl&0xf];
      jcomp2 = num_to_code[comp_lcl&0xf];
      jwork1 = num_to_code[(work_lcl>>4)&0xf];
      jcomp1 = num_to_code[(comp_lcl>>4)&0xf];
      num += jwork1*jcomp1; num += jwork2*jcomp2;

      bool mask = jwork1 > norm_work_t;
      norm_work_r = mask ? norm_work_t / jwork1 : jwork1 / norm_work_t;
      norm_work_s = mask*(1+norm_work_s*norm_work_r*norm_work_r)+(!mask)*(norm_work_s+norm_work_r*norm_work_r);
      norm_work_t = mask*jwork1 + (!mask)*norm_work_t;

      mask = jwork2 > norm_work_t;
      norm_work_r = mask ? norm_work_t / jwork2 : jwork2 / norm_work_t;
      norm_work_s = mask*(1+norm_work_s*norm_work_r*norm_work_r)+(!mask)*(norm_work_s+norm_work_r*norm_work_r);
      norm_work_t = mask*jwork2 + (!mask)*norm_work_t;

      mask = jcomp1 > norm_comp_t;
      norm_comp_r = mask ? norm_comp_t / jcomp1 : jcomp1 / norm_comp_t;
      norm_comp_s = mask*(1+norm_comp_s*norm_comp_r*norm_comp_r)+(!mask)*(norm_comp_s+norm_comp_r*norm_comp_r);
      norm_comp_t = mask*jcomp1 + (!mask)*norm_comp_t;

      mask = jcomp2 > norm_comp_t;
      norm_comp_r = mask ? norm_comp_t / jcomp2 : jcomp2 / norm_comp_t;
      norm_comp_s = mask*(1+norm_comp_s*norm_comp_r*norm_comp_r)+(!mask)*(norm_comp_s+norm_comp_r*norm_comp_r);
      norm_comp_t = mask*jcomp2 + (!mask)*norm_comp_t;

    }
    den = (norm_work_t*std::sqrt(norm_work_s))*(norm_comp_t*std::sqrt(norm_comp_s));
    acc += (1.0-num/den);
  }  
  return acc*1000000000000000ULL;
}
